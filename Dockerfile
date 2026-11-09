FROM node:22-alpine

WORKDIR /app

COPY demo/index.html demo/styles.css demo/app.js demo/data.mjs ./demo/
COPY scripts/serve-demo.mjs ./scripts/serve-demo.mjs
COPY runs/run-01/replay.json ./runs/run-01/replay.json
COPY runs/run-01/score.json ./runs/run-01/score.json
COPY runs/run-01/results.json ./runs/run-01/results.json
COPY examples/replay-synthetic.json examples/replay-partial-synthetic.json ./examples/

USER node
EXPOSE 8080
CMD ["node", "scripts/serve-demo.mjs", "--host", "0.0.0.0", "--port", "8080"]
