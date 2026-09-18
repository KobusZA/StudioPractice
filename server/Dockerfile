# Build context is the repository root, because the image serves web/ from the
# same origin as the API (see src/static.js):
#   docker build -f server/Dockerfile -t studiopractice-server .
FROM node:22-alpine

WORKDIR /app

COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install --omit=dev

COPY server ./server
COPY web ./web

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Not root. The process reads its own files and talks to Postgres; nothing it
# does needs more than that.
USER node

CMD ["node", "server/src/server.js"]
