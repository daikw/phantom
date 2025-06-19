import {
  executeGitCommand,
  executeGitCommandInDirectory,
} from "@aku11i/phantom-git";
import { type Result, err, isErr, isOk, ok } from "@aku11i/phantom-shared";
import { loadConfig } from "../config/loader.ts";
import { execInWorktree } from "../exec.ts";
import { WorktreeError, type WorktreeNotFoundError } from "./errors.ts";
import { validateWorktreeExists } from "./validate.ts";

export interface DeleteWorktreeOptions {
  force?: boolean;
}

export interface DeleteWorktreeSuccess {
  message: string;
  hasUncommittedChanges?: boolean;
  changedFiles?: number;
}

export interface WorktreeStatus {
  hasUncommittedChanges: boolean;
  changedFiles: number;
}

export interface PreDeleteExecutionOptions {
  gitRoot: string;
  worktreesDirectory: string;
  worktreeName: string;
  commands: string[];
}

export interface PreDeleteExecutionResult {
  executedCommands: string[];
}

export async function executePreDeleteCommands(
  options: PreDeleteExecutionOptions,
): Promise<Result<PreDeleteExecutionResult>> {
  const { gitRoot, worktreesDirectory, worktreeName, commands } = options;

  const executedCommands: string[] = [];

  for (const command of commands) {
    console.log(`Executing pre-delete command: ${command}`);
    const shell = process.env.SHELL || "/bin/sh";
    const cmdResult = await execInWorktree(
      gitRoot,
      worktreesDirectory,
      worktreeName,
      [shell, "-c", command],
    );

    if (isErr(cmdResult)) {
      const errorMessage =
        cmdResult.error instanceof Error
          ? cmdResult.error.message
          : String(cmdResult.error);
      return err(
        new Error(
          `Failed to execute pre-delete command "${command}": ${errorMessage}`,
        ),
      );
    }

    // Check exit code
    if (cmdResult.value.exitCode !== 0) {
      return err(
        new Error(
          `Pre-delete command failed with exit code ${cmdResult.value.exitCode}: ${command}`,
        ),
      );
    }

    executedCommands.push(command);
  }

  return ok({ executedCommands });
}

export async function getWorktreeChangesStatus(
  worktreePath: string,
): Promise<WorktreeStatus> {
  try {
    const { stdout } = await executeGitCommandInDirectory(worktreePath, [
      "status",
      "--porcelain",
    ]);
    if (stdout) {
      return {
        hasUncommittedChanges: true,
        changedFiles: stdout.split("\n").length,
      };
    }
  } catch {
    // If git status fails, assume no changes
  }
  return {
    hasUncommittedChanges: false,
    changedFiles: 0,
  };
}

export async function removeWorktree(
  gitRoot: string,
  worktreePath: string,
  force = false,
): Promise<void> {
  try {
    await executeGitCommand(["worktree", "remove", worktreePath], {
      cwd: gitRoot,
    });
  } catch (error) {
    // Always try force removal if the regular removal fails
    try {
      await executeGitCommand(["worktree", "remove", "--force", worktreePath], {
        cwd: gitRoot,
      });
    } catch {
      throw new Error("Failed to remove worktree");
    }
  }
}

export async function deleteBranch(
  gitRoot: string,
  branchName: string,
): Promise<Result<boolean, WorktreeError>> {
  try {
    await executeGitCommand(["branch", "-D", branchName], { cwd: gitRoot });
    return ok(true);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return err(new WorktreeError(`branch delete failed: ${errorMessage}`));
  }
}

export async function deleteWorktree(
  gitRoot: string,
  worktreeDirectory: string,
  name: string,
  options?: DeleteWorktreeOptions,
): Promise<
  Result<DeleteWorktreeSuccess, WorktreeNotFoundError | WorktreeError>
> {
  const { force = false } = options || {};

  const validation = await validateWorktreeExists(
    gitRoot,
    worktreeDirectory,
    name,
  );
  if (isErr(validation)) {
    return err(validation.error);
  }

  const worktreePath = validation.value.path;

  const status = await getWorktreeChangesStatus(worktreePath);

  if (status.hasUncommittedChanges && !force) {
    return err(
      new WorktreeError(
        `Worktree '${name}' has uncommitted changes (${status.changedFiles} files). Use --force to delete anyway.`,
      ),
    );
  }

  // Load configuration and execute pre-delete commands
  try {
    const configResult = await loadConfig(gitRoot);
    if (isOk(configResult) && configResult.value.preDelete?.commands) {
      const preDeleteResult = await executePreDeleteCommands({
        gitRoot,
        worktreesDirectory: worktreeDirectory,
        worktreeName: name,
        commands: configResult.value.preDelete.commands,
      });

      if (isErr(preDeleteResult)) {
        return err(new WorktreeError(preDeleteResult.error.message));
      }
    }
  } catch (error) {
    // If config loading fails, continue without pre-delete commands
    // This ensures backwards compatibility
  }

  try {
    await removeWorktree(gitRoot, worktreePath, force);

    const branchName = name;
    const branchResult = await deleteBranch(gitRoot, branchName);

    let message: string;
    if (isOk(branchResult)) {
      message = `Deleted worktree '${name}' and its branch '${branchName}'`;
    } else {
      message = `Deleted worktree '${name}'`;
      message += `\nNote: Branch '${branchName}' could not be deleted: ${branchResult.error.message}`;
    }

    if (status.hasUncommittedChanges) {
      message = `Warning: Worktree '${name}' had uncommitted changes (${status.changedFiles} files)\n${message}`;
    }

    return ok({
      message,
      hasUncommittedChanges: status.hasUncommittedChanges,
      changedFiles: status.hasUncommittedChanges
        ? status.changedFiles
        : undefined,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return err(new WorktreeError(`worktree remove failed: ${errorMessage}`));
  }
}
