#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write

import { basename, join, parseFlags, ProgressBar } from "./deps.ts";

import { Client, Progress } from "./mod.ts";

/** All optional params for the command as an object. */
const optionalParams: Record<string, unknown> = {};
/** Contains the command and its argument to be populated. */
const params: Array<unknown> = [];

const flags = parseFlags(Deno.args, {
  boolean: [
    /** Whether to follows redirect */
    "location",
    /** Whether to use remote name as output. */
    "remote-name",
    /** Whether to show progress bar. */
    "progress",
  ],
  negatable: [
    "progress",
  ],
  string: [
    "_",
    "username",
    "password",
    /** Any custom header */
    "header",
    /** Input body */
    "body",
    /** Output filename */
    "output",
    /** The exact size of the input stream if known in advance. */
    "size",
  ],
  collect: [
    "header",
  ],
  alias: {
    "username": ["user", "u"],
    "password": ["pass", "p"],
    "header": "H",
    "body": "B",
    "location": "L",
    "output": "o",
    "remote-name": ["O", "remoteName"],
  },
  default: {
    user: Deno.env.get("FSHARE_USER_EMAIL"),
    pass: Deno.env.get("FSHARE_PASSWORD"),
    progress: true,
  },
  /** Parses others into required and optional params */
  unknown: (arg: string, key?: string, value?: unknown) => {
    if (key) {
      optionalParams[key] = value;
    } else {
      params.push(arg);
    }
  },
});

// Places the optional params to the end.
if (Object.keys(optionalParams).length > 0) {
  params.push(optionalParams);
}

const {
  username,
  password,
  header,
  location,
  remoteName,
  progress,
  ...otherFlags
} = flags;

let {
  output,
  size,
} = otherFlags;

const [command, ...args] = params;

const headers = ([] as string[]).concat(header).reduce((headers, header: string) => {
  const [key, value] = header.split(/:\s?/);
  headers.append(key, value);
  return headers;
}, new Headers());

if (username && password) {
  headers.set("Authorization", `Basic ${btoa(`${username}:${password}`)}`);
}

const client = new Client({
  headers,
});
// Login
const response = await client.login();
if (!response.ok) {
  console.error("Login failed");
  Deno.exit(1);
}

let writable: WritableStream = Deno.stdout.writable;

if (output) {
  writable = (await Deno.open(output, {
    read: false,
    create: true,
    write: true,
  })).writable;
}

const redirect = location ? "follow" : "manual";

if (command === "download") {
  const { url, body, headers } = await client.download(args[0] as string, {
    redirect,
  });

  if (remoteName) {
    output = new URL(url).pathname.split("/").pop();
    if (!output) {
      console.error("Invalid URL");
      Deno.exit(1);
    }
    writable = (await Deno.open(output, {
      read: false,
      create: true,
      write: true,
    })).writable;
  }

  if (body) {
    const title = "downloading:";
    const total = Number(headers.get("Content-Length"));
    const progressBar = progress ? new ProgressBar({ title: title, total: total }) : undefined;
    body
      .pipeThrough(
        new Progress((progress) => {
          progressBar?.render(progress);
        }),
      )
      .pipeTo(writable);
  } else {
    console.log(headers.get("Location"));
  }
} else if (command === "upload") {
  const input = args[0] as string, path = args[1] as string || "/";
  if (!input) {
    console.error("Missing input file");
    Deno.exit(1);
  }

  let body: ReadableStream;
  const headers: HeadersInit = {};

  if (input === "-") {
    body = Deno.stdin.readable;
    if (!size) {
      console.error("Must provide size for input from stdin");
      Deno.exit(1);
    }
  } else {
    const file = await Deno.open(input, {
      read: true,
      write: false,
    });
    body = file.readable;
    if (!size) {
      size = `${(await file.stat()).size}`;
    }
  }

  const total = Number(size);
  headers["Content-Length"] = size;
  const title = "uploading:";

  const progressBar = progress ? new ProgressBar({ title: title, total: total }) : undefined;
  const response = await client.upload(join(path, basename(input)), {
    redirect,
    headers,
    body: body.pipeThrough(
      new Progress((progress) => {
        progressBar?.render(progress);
      }),
    ),
  });

  if (!response.ok) {
    console.error("Upload failed");
    Deno.exit(1);
  }

  const { url } = await response.json();
  console.log(url);
} else {
  // @ts-ignore - command is defined or just fail
  const response = await client[command](...args);
  if (!response.ok) {
    console.error(
      `Request failed with ${response.status} ${response.statusText}`,
    );
    Deno.exit(1);
  }

  console.log(await response.json());
}
