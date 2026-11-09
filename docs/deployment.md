# Container and Unikraft deployment

The deployment serves the replay-only evidence console. Its filesystem includes the reviewed browser assets, the Node server, the baseline replay/score/task results, and the clearly labeled synthetic examples. It intentionally excludes `.env`, `.local`, model-provider configuration, private agent/evaluation sources, and the full TrueForge `session.json` export. The public interface does not call a model or perform scans.

## Build and run with Docker

From the repository root:

```sh
docker build -t breakpoint-evidence:local .
docker run --rm -p 127.0.0.1:8080:8080 breakpoint-evidence:local
```

Open [http://127.0.0.1:8080](http://127.0.0.1:8080). The container listens on `0.0.0.0:8080`; the example publishes it only on the local loopback interface.

`Dockerfile` uses Node 22 Alpine and copies an explicit file allowlist. The server runs on Node built-ins, so the image does not install the repository’s unrelated evaluation dependencies. `.dockerignore` additionally denies environment files, local state, session exports, private source trees, and local setup notes. The server only returns the fields needed by the interface; its score metadata response never includes provider identifiers.

## Build and run with Unikraft

The included [Kraftfile](../Kraftfile) uses `base-compat:latest`, the `kraftcloud/x86_64` target, and the same Dockerfile root filesystem and Node server command. Authenticate with the Unikraft CLI using your normal account setup, then build and run with values for your registry organization and metro:

```sh
unikraft build . --output <organization>/breakpoint-evidence:latest
unikraft run --metro <metro> --name breakpoint-evidence -p 443:8080/http+tls --image <organization>/breakpoint-evidence:latest
```

The HTTP listener binds to `0.0.0.0:8080` inside the instance; the platform mapping provides the public HTTPS endpoint. See the official [Unikraft image documentation](https://unikraft.com/docs/platform/images) for Dockerfile root filesystems and Kraftfile targets.

The current live deployment target is the [BreakPoint evidence console](https://breakpoint.sfo.unikraft.app/).

For local Node startup, `npm run demo` binds to `127.0.0.1:4173` by default. Use `npm run demo -- --host 0.0.0.0 --port 8080` only when the process must accept connections from outside the local machine.
