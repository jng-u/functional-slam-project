FROM python:3.12-slim@sha256:5e2bdb1b0d542d5039cffb8181c65930093949194a65c365dfb1b0fe13a4fa5b

WORKDIR /app
COPY api_server.py ./
COPY dist/data/ ./dist/data/
RUN install -d -o 65534 -g 65534 /var/lib/functional-slam

USER 65534:65534
EXPOSE 11017
CMD ["python", "-B", "api_server.py", "--api-only", "--quota-db", "/var/lib/functional-slam/luna-quota.sqlite3"]
