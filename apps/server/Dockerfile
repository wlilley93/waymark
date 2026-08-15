FROM node:22-slim AS build
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN npm install --workspace @waymark/server --workspace @waymark/shared --include-workspace-root --no-audit --fund=false
COPY . .
RUN cd apps/server && npx tsc --noEmit || true

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo ./
EXPOSE 3000
CMD ["npm", "-w", "@waymark/server", "start"]
