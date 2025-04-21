# Chess Analyzer Application

This project is a chess analysis tool with a separate frontend and backend architecture, containerized with Docker for easy deployment to your own server.

## Project Structure

- **`/chessReview`** - Frontend application (React + Tailwind CSS)
- **`/chessBackend`** - Backend service (Python)

## Local Development Setup

### Backend Setup

```bash
cd chessBackend
python -m venv .venv  # If not already created
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
python server.py
```

### Frontend Setup

```bash
cd chessReview
npm install
npm start
```

## Deployment with Docker

This project uses Docker to containerize both the frontend and backend components, making it easy to deploy to your own server.

### Prerequisites

- Docker and Docker Compose installed on your server
- Git (optional, for cloning the repository)

### Deployment Steps

1. Clone or copy the project to your server

2. Build and start the containers:

```bash
cd chess-analyzer-app
docker-compose up -d --build
```

3. Access your application:
   - Frontend: http://your-server-ip
   - Backend API: http://your-server-ip:5000

### Monitoring and Management

```bash
# View logs
docker-compose logs -f

# Stop the application
docker-compose down

# Restart after changes
docker-compose up -d --build
```

## Configuration

You can modify environment variables and ports in the `docker-compose.yml` file to suit your server setup.
