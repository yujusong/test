FROM python:3.12-slim
COPY --from=cloudflare/cloudflared:2026.3.0 /usr/local/bin/cloudflared /usr/local/bin/cloudflared
WORKDIR /app
# supabase-js is vendored at build time so the page only loads scripts from its own origin.
ARG SUPABASE_JS=2.45.4
RUN pip install --no-cache-dir qrcode==8.2 \
 && mkdir -p /app/public/vendor \
 && python -c "import urllib.request; urllib.request.urlretrieve('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@${SUPABASE_JS}/dist/umd/supabase.js', '/app/public/vendor/supabase.js')" \
 && useradd --uid 10001 --create-home paper \
 && mkdir /data && chown paper:paper /data
COPY server.py stores.py /app/
COPY public /app/public
USER paper
ENV PORT=8080 SESSION_SECONDS=3600 DATA_PATH=/data/paper.sqlite PYTHONUNBUFFERED=1
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/api/session')"
CMD ["python", "server.py"]
