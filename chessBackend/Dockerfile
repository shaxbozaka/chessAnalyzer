FROM python:3.9-slim

WORKDIR /app

# Install necessary dependencies for Stockfish
RUN apt-get update && apt-get install -y \
    stockfish \
    && rm -rf /var/lib/apt/lists/*

# Create directory for Stockfish engine and opening book
RUN mkdir -p /opt/stockfish

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Set environment variable for Stockfish path
ENV STOCKFISH_PATH=/usr/games/stockfish
ENV BOOK_PATH=/app/src/bookfish.bin
ENV PORT=8080

EXPOSE 8080

CMD ["python", "server.py"]
