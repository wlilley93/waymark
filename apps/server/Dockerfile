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
# wait for postgres before migrating/serving: compose health gates race first boot
CMD ["sh", "-c", "i=0; until node -e \"const n=require('net');const s=n.connect(5432,process.env.PGHOST||'postgres',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1))\" 2>/dev/null; do i=$((i+1)); [ $i -gt 60 ] && echo 'postgres unreachable' && exit 1; sleep 2; done; exec npm -w @waymark/server start"]
