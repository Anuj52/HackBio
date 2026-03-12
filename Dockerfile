FROM python:3.12-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

# Copy project files
COPY . .

# Create output directories
RUN mkdir -p output charts

EXPOSE 5000

# Default: run the live dashboard
CMD ["python", "dashboard.py"]
