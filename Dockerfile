FROM python:3.12-slim

WORKDIR /app

# Install dependencies first (Docker layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt

# Copy application code
COPY src/ src/
COPY users.json .

EXPOSE 8000

# Single worker: APScheduler + threading.Timer work safely in one process
CMD ["gunicorn", "-w", "1", "-b", "0.0.0.0:8000", "--timeout", "1800", "--preload", "src.backend.api_server:app"]
