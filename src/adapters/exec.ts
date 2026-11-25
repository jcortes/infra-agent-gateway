import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function exec(cmd: string, args: string[], opts: { cwd?: string; input?: string; okExitCodes?: number[] } = {}) {
  try {
    if (opts.input !== undefined) {
      return await new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => {
        const child = execFile(cmd, args, { cwd: opts.cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
          const code = (err as { code?: number } | null)?.code;
          if (err && !(typeof code === "number" && opts.okExitCodes?.includes(code))) reject(Object.assign(err, { stdout, stderr }));
          else resolve({ stdout, stderr, code: typeof code === "number" ? code : 0 });
        });
        child.stdin!.end(opts.input);
      });
    }
    return { ...(await run(cmd, args, { cwd: opts.cwd, maxBuffer: 64 * 1024 * 1024 })), code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string; code?: unknown };
    if (typeof e.code === "number" && opts.okExitCodes?.includes(e.code)) {
      return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", code: e.code };
    }
    throw new Error(`${cmd} ${args[0]} failed: ${(e.stderr || e.message).trim().slice(0, 2000)}`);
  }
}
