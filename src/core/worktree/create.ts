import fs from "node:fs/promises";
import { addWorktree } from "../git/libs/add-worktree.ts";
import { getPhantomDirectory, getWorktreePath } from "../paths.ts";
import { type Result, err, isErr, isOk, ok } from "../types/result.ts";
import {
  GitOperationError,
  type WorktreeAlreadyExistsError,
} from "./errors.ts";
import { copyFiles } from "./file-copier.ts";
import {
  validateWorktreeDoesNotExist,
  validateWorktreeName,
} from "./validate.ts";

export interface CreateWorktreeOptions {
  branch?: string;
  base?: string;
  copyFiles?: string[];
}

export interface CreateWorktreeSuccess {
  message: string;
  path: string;
  copiedFiles?: string[];
  skippedFiles?: string[];
  copyError?: string;
}

export async function createWorktree(
  gitRoot: string,
  name: string,
  options: CreateWorktreeOptions = {},
): Promise<
  Result<CreateWorktreeSuccess, WorktreeAlreadyExistsError | GitOperationError>
> {
  const nameValidation = validateWorktreeName(name);
  if (isErr(nameValidation)) {
    return nameValidation;
  }

  const { branch = name, base = "HEAD" } = options;

  const worktreesPath = getPhantomDirectory(gitRoot);
  const worktreePath = getWorktreePath(gitRoot, name);

  try {
    await fs.access(worktreesPath);
  } catch {
    await fs.mkdir(worktreesPath, { recursive: true });
  }

  const validation = await validateWorktreeDoesNotExist(gitRoot, name);
  if (isErr(validation)) {
    return err(validation.error);
  }

  try {
    await addWorktree({
      path: worktreePath,
      branch,
      base,
    });

    let copiedFiles: string[] | undefined;
    let skippedFiles: string[] | undefined;
    let copyError: string | undefined;

    if (options.copyFiles && options.copyFiles.length > 0) {
      const copyResult = await copyFiles(
        gitRoot,
        worktreePath,
        options.copyFiles,
      );

      if (isOk(copyResult)) {
        copiedFiles = copyResult.value.copiedFiles;
        skippedFiles = copyResult.value.skippedFiles;
      } else {
        copyError = copyResult.error.message;
      }
    }

    return ok({
      message: `Created worktree '${name}' at ${worktreePath}`,
      path: worktreePath,
      copiedFiles,
      skippedFiles,
      copyError,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return err(new GitOperationError("worktree add", errorMessage));
  }
}
