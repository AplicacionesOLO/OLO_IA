# syntax=docker/dockerfile:1

# ── Etapa de dependencias ─────────────────────────────────────────────────
FROM python:3.12-slim AS deps
WORKDIR /srv/olo
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1
COPY pyproject.toml ./
COPY src/ ./src/
RUN pip install --no-cache-dir .

# ── Etapa final ───────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime
WORKDIR /srv/olo
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

# Usuario sin privilegios: el contenedor nunca corre como root.
RUN useradd --create-home --shell /usr/sbin/nologin appuser

COPY --from=deps /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=deps /usr/local/bin /usr/local/bin
COPY src/ ./src/

USER appuser
EXPOSE 8000

# La sonda usa /health (liveness), que NO consulta la base de datos. Si la
# consultara, una caída de la base reiniciaría en bucle un proceso sano.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=2).status==200 else 1)"

CMD ["sh", "-c", "uvicorn --factory olo.main:create_app --host 0.0.0.0 --port ${PORT} --proxy-headers"]
