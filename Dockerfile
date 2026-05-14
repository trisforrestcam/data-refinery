FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 5001

CMD ["node", "-r", "tsconfig-paths/register", "dist/main.js"]
