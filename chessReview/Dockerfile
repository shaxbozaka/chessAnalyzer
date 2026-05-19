# Build stage
FROM node:16-alpine as build

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install exactly what is recorded in package-lock.json.
RUN npm ci

# Copy the application code
COPY . .

# Create a production build
RUN npm run build

# Production stage
FROM nginx:stable-alpine

# Copy build output from build stage
COPY --from=build /app/build /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
