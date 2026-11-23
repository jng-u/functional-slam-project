import json
import sqlite3
import sys
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from http.client import HTTPResponse
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import api_server


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class MemoryConnection:
    def __init__(self, request):
        self.request = BytesIO(request)
        self.response = BytesIO()

    def makefile(self, *_):
        return self.request

    def sendall(self, data):
        self.response.write(data)


class GraphQueryApiTests(unittest.TestCase):
    def setUp(self):
        self.nodes = [
            {"id": "U1", "label": "handle", "role": "U"},
            {"id": "C1", "label": "drawer", "role": "C"},
        ]
        self.edges = [
            {"src": "U1", "dst": "C1", "text": "pull to open or close", "status": "committed"},
            {"src": "U1", "dst": "C1", "text": "invented relation", "status": "tentative"},
        ]

    def test_input_keeps_only_committed_edges_with_known_endpoints(self):
        data = {
            "query": "서랍 열어줘",
            "nodes": self.nodes,
            "edges": [{
                "src": "U1", "dst": "missing", "text": "unknown target", "status": "committed",
            }] + self.edges,
        }
        query, nodes, edges = api_server._clean_graph(data)
        self.assertEqual(query, "서랍 열어줘")
        self.assertEqual([node["id"] for node in nodes], ["U1", "C1"])
        self.assertEqual([edge["index"] for edge in edges], [1])

    def test_result_discards_unrecognized_ids_and_edges(self):
        _, nodes, edges = api_server._clean_graph({
            "query": "서랍 열어줘", "nodes": self.nodes, "edges": self.edges,
        })
        result = api_server._validated_result({
            "node_ids": ["missing", "U1"],
            "edge_indices": [0, 1, 99, True],
            "candidate_only": True,
        }, nodes, edges)
        self.assertEqual(result, {
            "node_ids": ["U1"],
            "edge_indices": [0],
            "candidate_only": False,
        })
        self.assertFalse(api_server._validated_result({
            "node_ids": ["U1"], "edge_indices": [], "candidate_only": "true",
        }, nodes, edges)["candidate_only"])

    def test_query_calls_luna_and_returns_validated_graph_ids(self):
        completion = {
            "choices": [{"message": {"content": json.dumps({
                "node_ids": ["U1"], "edge_indices": [0],
                "candidate_only": False,
            }, ensure_ascii=False)}}],
        }
        observed = {}

        def opener(request, timeout):
            observed["url"] = request.full_url
            observed["headers"] = dict(request.header_items())
            observed["payload"] = json.loads(request.data)
            observed["timeout"] = timeout
            return FakeResponse(completion)

        _, nodes, edges = api_server._clean_graph({
            "query": "서랍 열어줘", "nodes": self.nodes, "edges": self.edges,
        })
        result = api_server.query_luna("서랍 열어줘", nodes, edges, "test-key", opener=opener)
        self.assertEqual(observed["url"], "https://api.openai.com/v1/chat/completions")
        self.assertEqual(observed["payload"]["model"], "gpt-6-luna")
        self.assertEqual(observed["payload"]["reasoning_effort"], "low")
        self.assertEqual(observed["payload"]["response_format"], {"type": "json_object"})
        self.assertEqual(observed["timeout"], 45)
        self.assertEqual(result["node_ids"], ["U1"])
        self.assertEqual(result["edge_indices"], [0])

    def test_query_rate_limit_is_per_client_and_expires_after_one_minute(self):
        client = "test-client"
        api_server._request_times.pop(client, None)
        for _ in range(api_server.RATE_LIMIT_PER_IP):
            self.assertTrue(api_server.allow_request(client, now=100))
        self.assertFalse(api_server.allow_request(client, now=100))
        self.assertTrue(api_server.allow_request(client, now=160))


class DailyQuotaTests(unittest.TestCase):
    def setUp(self):
        tmp = TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.db = self.root / "state" / "quota.sqlite3"
        self.quota = api_server.DailyQuota(self.db)
        (self.root / "data").mkdir()
        (self.root / "data" / "graph.json").write_text('{"nodes": [], "edges": []}')

    def request(self, method, path="/api/query", body=b"", ip="192.0.2.1"):
        request = (
            f"{method} {path} HTTP/1.1\r\n"
            f"Origin: https://owner.github.io\r\nContent-Length: {len(body)}\r\n\r\n"
        ).encode() + body
        connection = MemoryConnection(request)
        api_server.Handler(connection, (ip, 12345), None, directory=str(self.root),
                           quota=self.quota, api_only=True)
        connection.request = BytesIO(connection.response.getvalue())
        with HTTPResponse(connection) as response:
            response.begin()
            return response.status, response.headers, response.read()

    def test_concurrent_reservations_persist_and_reset_at_korean_midnight(self):
        before_reset = datetime(2026, 11, 23, 14, 59, 59, 500000, tzinfo=timezone.utc)
        with ThreadPoolExecutor(max_workers=12) as pool:
            reservations = list(pool.map(lambda _: self.quota.reserve(before_reset), range(120)))
        self.assertEqual(reservations.count(None), 100)
        self.assertEqual(reservations.count(1), 20)
        reopened = api_server.DailyQuota(self.db)
        self.assertEqual(reopened.reserve(before_reset), 1)
        self.assertIsNone(reopened.reserve(before_reset + timedelta(milliseconds=500)))

    @patch.dict("os.environ", {"OPENAI_API_KEY": "test-key", "LUNA_CORS_ORIGIN": "https://owner.github.io"})
    @patch.object(api_server.Handler, "log_message")
    @patch.object(api_server, "query_luna")
    def test_http_quota_is_global_and_counts_openai_attempts(self, query_luna, _log):
        body = b'{"query": "drawer"}'
        self.assertEqual(self.request("GET", "/healthz")[0], 200)
        self.assertEqual(self.request("GET", "/data/graph.json")[0], 404)
        self.assertEqual(self.request("OPTIONS")[0], 204)
        self.assertEqual(self.request("POST", body=b"{}")[0], 400)
        query_luna.side_effect = api_server.QueryError("Upstream unavailable")
        self.assertEqual(self.request("POST", body=body)[0], 502)
        query_luna.side_effect = None
        query_luna.return_value = {"node_ids": [], "edge_indices": [], "candidate_only": False}
        for _ in range(99):
            self.assertEqual(self.request("POST", body=body)[0], 200)

        self.quota = api_server.DailyQuota(self.db)
        status, headers, payload = self.request("POST", body=body, ip="192.0.2.2")
        self.assertEqual(status, 429)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "https://owner.github.io")
        self.assertEqual(headers["Access-Control-Expose-Headers"], "Retry-After")
        self.assertGreater(int(headers["Retry-After"]), 0)
        self.assertIn("100건", json.loads(payload)["error"])
        self.assertEqual(query_luna.call_count, 100)

    @patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"})
    @patch.object(api_server.Handler, "log_message")
    @patch.object(api_server, "query_luna")
    def test_storage_failure_blocks_the_openai_call(self, query_luna, _log):
        with patch.object(self.quota, "reserve", side_effect=sqlite3.OperationalError):
            self.assertEqual(self.request("POST", body=b'{"query": "drawer"}')[0], 503)
        query_luna.assert_not_called()


if __name__ == "__main__":
    unittest.main()
