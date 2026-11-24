FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    YOLO_CONFIG_DIR=/tmp/Ultralytics

RUN apt-get update && apt-get install -y --no-install-recommends \
      libglib2.0-0 \
      libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

# Instalar PyTorch solo-CPU primero evita descargar librerías CUDA innecesarias en laptops de campo
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu \
      torch torchvision

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    # ultralytics arrastra opencv-python (con GUI, pide libxcb/libGL); en un servidor basta la versión headless
    && pip uninstall -y opencv-python \
    && pip install --no-cache-dir --force-reinstall --no-deps "opencv-python-headless>=4.10.0,<5.0.0" \
    && python -c "import cv2; print('OpenCV', cv2.__version__)"

COPY detector.py servicio.py __init__.py ./
COPY modelos ./modelos

RUN useradd --create-home argos && mkdir -p /tmp/Ultralytics && chown -R argos:argos /tmp/Ultralytics
USER argos

EXPOSE 8001
HEALTHCHECK --interval=15s --timeout=5s --start-period=120s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/salud')"

CMD ["python", "servicio.py"]
