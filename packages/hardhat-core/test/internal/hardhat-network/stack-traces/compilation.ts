import fs from "fs";
import path from "path";
import {
  Compiler as SolcJsCompiler,
  NativeCompiler,
} from "../../../../src/internal/solidity/compiler";
import {
  Compiler,
  CompilerDownloader,
} from "../../../../src/internal/solidity/compiler/downloader";
import { getCompilersDir } from "../../../../src/internal/util/global-dir";

import { CompilerInput, CompilerOutput } from "../../../../src/types";

export interface CompilerOptions {
  solidityVersion: string;
  compilerPath: string;
  runs?: number;
}

interface SolcSourceFileToContents {
  [filename: string]: { content: string };
}

function getSolcSourceFileMapping(sources: string[]): SolcSourceFileToContents {
  return Object.assign(
    {},
    ...sources.map((s) => ({
      [path.basename(s)]: { content: fs.readFileSync(s, "utf8") },
    }))
  );
}

function getSolcInput(
  sources: SolcSourceFileToContents,
  compilerOptions: CompilerOptions
): CompilerInput {
  return {
    language: "Solidity",
    sources,
    settings: {
      optimizer: {
        enabled: compilerOptions.runs !== undefined,
        runs: compilerOptions.runs ?? 200,
      },
      outputSelection: {
        "*": {
          "*": [
            "abi",
            "evm.bytecode",
            "evm.deployedBytecode",
            "evm.methodIdentifiers",
          ],
          "": ["id", "ast"],
        },
      },
    },
  };
}

function getSolcInputForFiles(
  sources: string[],
  compilerOptions: CompilerOptions
): CompilerInput {
  return getSolcInput(getSolcSourceFileMapping(sources), compilerOptions);
}

function getSolcInputForLiteral(
  source: string,
  compilerOptions: CompilerOptions,
  filename: string = "literal.sol"
): CompilerInput {
  return getSolcInput({ [filename]: { content: source } }, compilerOptions);
}

export const COMPILER_DOWNLOAD_TIMEOUT = 10000;

async function compile(
  input: CompilerInput,
  compiler: Compiler
): Promise<[CompilerInput, CompilerOutput]> {
  let runnableCompiler: any;
  if (compiler.isSolcJs) {
    runnableCompiler = new SolcJsCompiler(compiler.compilerPath);
  } else {
    runnableCompiler = new NativeCompiler(compiler.compilerPath);
  }

  const output = await runnableCompiler.compile(input);

  if (output.errors !== undefined) {
    for (const error of output.errors) {
      if (error.severity === "error") {
        throw new Error(`Failed to compile: ${error.message}`);
      }
    }
  }

  return [input, output];
}

export async function compileFiles(
  sources: string[],
  compilerOptions: CompilerOptions
): Promise<[CompilerInput, CompilerOutput]> {
  let compiler: Compiler;
  // special case for running tests with custom solc
  if (path.isAbsolute(compilerOptions.compilerPath)) {
    compiler = {
      compilerPath: compilerOptions.compilerPath,
      isSolcJs: process.env.HARDHAT_TESTS_SOLC_NATIVE !== "true",
      version: compilerOptions.solidityVersion,
      longVersion: compilerOptions.solidityVersion,
    };
  } else {
    compiler = await getCompilerForVersion(compilerOptions.solidityVersion);
  }

  return compile(getSolcInputForFiles(sources, compilerOptions), compiler);
}

export async function compileLiteral(
  source: string,
  compilerOptions: CompilerOptions = {
    solidityVersion: "0.8.0",
    compilerPath: "soljson-v0.8.0+commit.c7dfd78e.js",
    runs: 1,
  },
  filename: string = "literal.sol"
): Promise<[CompilerInput, CompilerOutput]> {
  await downloadCompiler(compilerOptions.solidityVersion);
  const compiler = await getCompilerForVersion(compilerOptions.solidityVersion);

  return compile(
    getSolcInputForLiteral(source, compilerOptions, filename),
    compiler
  );
}

async function getCompilerForVersion(
  solidityVersion: string
): Promise<Compiler> {
  const compilersCache = await getCompilersDir();
  const compilerPlatform = CompilerDownloader.getCompilerPlatform();
  const downloader = CompilerDownloader.getConcurrencySafeDownloader(
    compilerPlatform,
    compilersCache
  );
  const compiler = await downloader.getCompiler(solidityVersion);
  if (compiler === undefined) {
    throw new Error("Expected compiler to be downloaded");
  }

  return compiler;
}

export async function downloadCompiler(solidityVersion: string) {
  const compilersCache = await getCompilersDir();
  const compilerPlatform = CompilerDownloader.getCompilerPlatform();
  const downloader = CompilerDownloader.getConcurrencySafeDownloader(
    compilerPlatform,
    compilersCache
  );

  const isCompilerDownloaded = await downloader.isCompilerDownloaded(
    solidityVersion
  );

  if (!isCompilerDownloaded) {
    await downloader.downloadCompiler(solidityVersion);
  }
}
