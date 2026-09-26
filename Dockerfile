FROM postgres:17-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/venv && useradd --uid 10001 --create-home selene
ENV PATH="/opt/venv/bin:$PATH" PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv/selene
COPY requirements-runtime.lock ./
RUN pip install --no-cache-dir -r requirements-runtime.lock
COPY app ./app
COPY migrations ./migrations
COPY alembic.ini ./
COPY public ./public
USER 10001:10001
EXPOSE 8000
ENTRYPOINT []
CMD ["uvicorn","app.main:app","--host","0.0.0.0","--port","8000","--no-access-log","--proxy-headers"]
