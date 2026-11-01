import { createServer } from "node:http";
createServer((_q, r) => r.end("up " + process.pid)).listen(Number(process.env.PORT), "127.0.0.1", () => console.log("listening", process.pid));
