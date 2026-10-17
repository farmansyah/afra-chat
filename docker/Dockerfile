FROM python:3.12-slim
WORKDIR /app
COPY server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server/server.py ./server/
COPY web/ ./web/
ENV CHAT_DATA=/data WEB_DIR=/app/web
VOLUME /data
WORKDIR /app/server
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080", "--proxy-headers", "--forwarded-allow-ips", "*", "--ws-max-size", "131072"]
