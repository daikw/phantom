import { deepStrictEqual } from "node:assert";
import { describe, it, mock } from "node:test";
import { err, ok } from "../types/result.ts";
import { BranchNotFoundError, WorktreeAlreadyExistsError } from "./errors.ts";

const validateWorktreeNameMock = mock.fn();
const existsSyncMock = mock.fn();
const branchExistsMock = mock.fn();
const attachWorktreeMock = mock.fn();
const getWorktreePathMock = mock.fn(
  (gitRoot, name) => `${gitRoot}/.git/phantom/worktrees/${name}`,
);

mock.module("./validate.ts", {
  namedExports: {
    validateWorktreeName: validateWorktreeNameMock,
  },
});

mock.module("node:fs", {
  namedExports: {
    existsSync: existsSyncMock,
  },
});

mock.module("../git/libs/branch-exists.ts", {
  namedExports: {
    branchExists: branchExistsMock,
  },
});

mock.module("../git/libs/attach-worktree.ts", {
  namedExports: {
    attachWorktree: attachWorktreeMock,
  },
});

mock.module("../paths.ts", {
  namedExports: {
    getWorktreePath: getWorktreePathMock,
  },
});

const { attachWorktreeCore } = await import("./attach.ts");

describe("attachWorktreeCore", () => {
  const resetMocks = () => {
    validateWorktreeNameMock.mock.resetCalls();
    existsSyncMock.mock.resetCalls();
    branchExistsMock.mock.resetCalls();
    attachWorktreeMock.mock.resetCalls();
    getWorktreePathMock.mock.resetCalls();
  };

  it("should attach to existing branch successfully", async () => {
    resetMocks();
    validateWorktreeNameMock.mock.mockImplementation(() => ok(undefined));
    existsSyncMock.mock.mockImplementation(() => false);
    branchExistsMock.mock.mockImplementation(() => Promise.resolve(ok(true)));
    attachWorktreeMock.mock.mockImplementation(() =>
      Promise.resolve(ok(undefined)),
    );

    const result = await attachWorktreeCore("/repo", "feature-branch");

    deepStrictEqual(result.ok, true);
    if (result.ok) {
      deepStrictEqual(
        result.value,
        "/repo/.git/phantom/worktrees/feature-branch",
      );
    }

    deepStrictEqual(validateWorktreeNameMock.mock.calls[0].arguments, [
      "feature-branch",
    ]);
    deepStrictEqual(existsSyncMock.mock.calls[0].arguments, [
      "/repo/.git/phantom/worktrees/feature-branch",
    ]);
    deepStrictEqual(branchExistsMock.mock.calls[0].arguments, [
      "/repo",
      "feature-branch",
    ]);
    deepStrictEqual(attachWorktreeMock.mock.calls[0].arguments, [
      "/repo",
      "/repo/.git/phantom/worktrees/feature-branch",
      "feature-branch",
    ]);
  });

  it("should return error when worktree name is invalid", async () => {
    resetMocks();
    validateWorktreeNameMock.mock.mockImplementation(() =>
      err(new Error("Invalid worktree name: feature/branch")),
    );

    const result = await attachWorktreeCore("/repo", "feature/branch");

    deepStrictEqual(result.ok, false);
    if (!result.ok) {
      deepStrictEqual(
        result.error.message,
        "Invalid worktree name: feature/branch",
      );
    }

    deepStrictEqual(existsSyncMock.mock.calls.length, 0);
    deepStrictEqual(branchExistsMock.mock.calls.length, 0);
  });

  it("should return error when worktree already exists", async () => {
    resetMocks();
    validateWorktreeNameMock.mock.mockImplementation(() => ok(undefined));
    existsSyncMock.mock.mockImplementation(() => true);

    const result = await attachWorktreeCore("/repo", "existing-feature");

    deepStrictEqual(result.ok, false);
    if (!result.ok) {
      deepStrictEqual(result.error instanceof WorktreeAlreadyExistsError, true);
      deepStrictEqual(
        result.error.message,
        "Worktree 'existing-feature' already exists",
      );
    }

    deepStrictEqual(branchExistsMock.mock.calls.length, 0);
  });

  it("should return error when branch does not exist", async () => {
    resetMocks();
    validateWorktreeNameMock.mock.mockImplementation(() => ok(undefined));
    existsSyncMock.mock.mockImplementation(() => false);
    branchExistsMock.mock.mockImplementation(() => Promise.resolve(ok(false)));

    const result = await attachWorktreeCore("/repo", "non-existent");

    deepStrictEqual(result.ok, false);
    if (!result.ok) {
      deepStrictEqual(result.error instanceof BranchNotFoundError, true);
      deepStrictEqual(result.error.message, "Branch 'non-existent' not found");
    }

    deepStrictEqual(attachWorktreeMock.mock.calls.length, 0);
  });

  it("should pass through git attach errors", async () => {
    resetMocks();
    validateWorktreeNameMock.mock.mockImplementation(() => ok(undefined));
    existsSyncMock.mock.mockImplementation(() => false);
    branchExistsMock.mock.mockImplementation(() => Promise.resolve(ok(true)));
    attachWorktreeMock.mock.mockImplementation(() =>
      Promise.resolve(err(new Error("Git operation failed"))),
    );

    const result = await attachWorktreeCore("/repo", "feature");

    deepStrictEqual(result.ok, false);
    if (!result.ok) {
      deepStrictEqual(result.error.message, "Git operation failed");
    }
  });

  it("should handle branch existence check errors", async () => {
    resetMocks();
    validateWorktreeNameMock.mock.mockImplementation(() => ok(undefined));
    existsSyncMock.mock.mockImplementation(() => false);
    branchExistsMock.mock.mockImplementation(() =>
      Promise.resolve(err(new Error("Failed to check branch"))),
    );

    const result = await attachWorktreeCore("/repo", "feature");

    deepStrictEqual(result.ok, false);
    if (!result.ok) {
      deepStrictEqual(result.error.message, "Failed to check branch");
    }

    deepStrictEqual(attachWorktreeMock.mock.calls.length, 0);
  });
});
