# Build stage
FROM node:16-alpine as build

WORKDIR /app

# Copy package files
COPY package*.json ./

# Clean install dependencies and explicitly install react-scripts
RUN npm install
RUN npm install react-scripts@5.0.1 --save

# Copy the application code
COPY . .

# Create a production build with direct call to build.js
RUN mkdir -p build && \
    NODE_ENV=production node ./node_modules/react-scripts/scripts/build.js

# Production stage
FROM nginx:stable-alpine

# Copy build output from build stage
COPY --from=build /app/build /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
