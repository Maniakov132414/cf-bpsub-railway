FROM node:20-alpine

WORKDIR /app

# Install curl, unzip, ca-certificates for Xray
RUN apk add --no-cache curl unzip ca-certificates

# Download and install Xray core
RUN curl -sL https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip -o xray.zip \
    && unzip -q xray.zip xray geosite.dat geoip.dat \
    && chmod +x xray \
    && rm -f xray.zip

COPY package*.json ./

RUN npm install --production

COPY . .

ENV PORT=8080
EXPOSE 8080
EXPOSE 8888

CMD ["node", "server.js"]

