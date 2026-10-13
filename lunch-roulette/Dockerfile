FROM python:3.12-slim
COPY --from=cloudflare/cloudflared:2026.3.0 /usr/local/bin/cloudflared /usr/local/bin/cloudflared
WORKDIR /app
RUN pip install --no-cache-dir qrcode==8.2 && useradd --uid 10001 --create-home lunch
COPY server.py /app/server.py
COPY public /app/public
RUN mkdir /data && chown lunch:lunch /data
USER lunch
ENV PORT=8080 SESSION_SECONDS=3600 DATA_PATH=/data/votes.sqlite
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/api/session')"
CMD ["python", "server.py"]
