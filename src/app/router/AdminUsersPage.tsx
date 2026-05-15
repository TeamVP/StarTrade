import { FormEvent, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type AdminUserRow = {
  _id: Id<"users">;
  createdAt: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  image: string | null;
  emailVerificationTime: number | null;
  phoneVerificationTime: number | null;
  isAnonymous: boolean;
  hasPasswordAccount: boolean;
};

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function formatOptionalTimestamp(timestamp: number | null): string {
  return timestamp === null ? "-" : formatTimestamp(timestamp);
}

function mutationErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^[\s\S]*?Error:\s*/g, "").trim() || "Something went wrong.";
}

function stringFromFormData(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export function AdminUsersPage() {
  const userResult = useQuery(api.admin.queries.listUsers, { limit: 100 });
  const createUser = useMutation(api.admin.mutations.createUser);
  const setUserPassword = useMutation(api.admin.mutations.setUserPassword);
  const deleteUser = useMutation(api.admin.mutations.deleteUser);
  const [submitting, setSubmitting] = useState(false);
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<Id<"users"> | null>(null);
  const [passwordUser, setPasswordUser] = useState<AdminUserRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (userResult?.authorized === false) {
      setError("Authentication required.");
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const name = stringFromFormData(formData, "name").trim();
    const email = stringFromFormData(formData, "email").trim();
    const phone = stringFromFormData(formData, "phone").trim();
    const image = stringFromFormData(formData, "image").trim();
    const password = stringFromFormData(formData, "password");
    const isAnonymous = formData.get("isAnonymous") === "on";
    const emailVerified = formData.get("emailVerified") === "on";
    const phoneVerified = formData.get("phoneVerified") === "on";

    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await createUser({
        name: name.length > 0 ? name : null,
        email: email.length > 0 ? email : null,
        phone: phone.length > 0 ? phone : null,
        image: image.length > 0 ? image : null,
        password: password.trim().length > 0 ? password : null,
        isAnonymous,
        emailVerified,
        phoneVerified,
      });
      form.reset();
      setSuccess(
        password.trim().length > 0
          ? "Created user record with password sign-in."
          : "Created user record.",
      );
    } catch (createError) {
      setError(mutationErrorMessage(createError));
    } finally {
      setSubmitting(false);
    }
  }

  async function onSetUserPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (passwordUser === null) {
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const password = stringFromFormData(formData, "setPassword");
    const label = passwordUser.email ?? passwordUser.name ?? passwordUser._id;

    setPasswordSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await setUserPassword({
        userId: passwordUser._id,
        password,
      });
      setSuccess(
        result.createdAccount
          ? `Enabled password sign-in for ${label}.`
          : `Updated password sign-in for ${label}.`,
      );
      setPasswordUser(null);
      form.reset();
    } catch (passwordError) {
      setError(mutationErrorMessage(passwordError));
    } finally {
      setPasswordSubmitting(false);
    }
  }

  async function onDeleteUser(user: AdminUserRow) {
    const label = user.email ?? user.name ?? user._id;
    if (!window.confirm(`Delete user ${label}? This removes the users row and linked auth/profile records.`)) {
      return;
    }

    setDeletingUserId(user._id);
    setError(null);
    setSuccess(null);
    try {
      await deleteUser({ userId: user._id });
      setSuccess(`Deleted user ${label}.`);
    } catch (deleteError) {
      setError(mutationErrorMessage(deleteError));
    } finally {
      setDeletingUserId(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-st-fg">Users</h1>
        <p className="text-sm text-st-muted">
          View and create records in the Convex <span className="font-mono text-st-fg">users</span> table.
        </p>
      </div>

      <Card className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">Create User</h2>
          <p className="mt-1 text-sm text-st-muted">
            Inserts a new row directly into the Convex <span className="font-mono text-st-fg">users</span> table. Add a password to provision email/password sign-in at the same time.
          </p>
        </div>
        <form className="grid gap-3 md:grid-cols-2" onSubmit={(event) => void onSubmit(event)}>
          <label className="space-y-1 text-sm text-st-muted">
            <span>Name</span>
            <input
              type="text"
              name="name"
              placeholder="Optional"
              className="w-full rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
            />
          </label>
          <label className="space-y-1 text-sm text-st-muted">
            <span>Email</span>
            <input
              type="email"
              name="email"
              placeholder="Optional"
              className="w-full rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
            />
          </label>
          <label className="space-y-1 text-sm text-st-muted">
            <span>Phone</span>
            <input
              type="text"
              name="phone"
              placeholder="Optional"
              className="w-full rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
            />
          </label>
          <label className="space-y-1 text-sm text-st-muted">
            <span>Image URL</span>
            <input
              type="text"
              name="image"
              placeholder="Optional"
              className="w-full rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
            />
          </label>
          <label className="space-y-1 text-sm text-st-muted md:col-span-2">
            <span>Password</span>
            <input
              type="password"
              name="password"
              minLength={8}
              placeholder="Optional; leave blank for a table-only user"
              className="w-full rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
            />
          </label>
          <div className="md:col-span-2 grid gap-2 sm:grid-cols-3">
            <label className="flex items-center gap-2 rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
              <input type="checkbox" name="isAnonymous" className="accent-cyan-400" />
              <span>Anonymous</span>
            </label>
            <label className="flex items-center gap-2 rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
              <input type="checkbox" name="emailVerified" className="accent-cyan-400" />
              <span>Set email verified now</span>
            </label>
            <label className="flex items-center gap-2 rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
              <input type="checkbox" name="phoneVerified" className="accent-cyan-400" />
              <span>Set phone verified now</span>
            </label>
          </div>
          <div className="md:col-span-2 flex items-center gap-3">
            <Button type="submit" disabled={submitting || userResult?.authorized === false}>
              {submitting ? "Creating..." : "Create user"}
            </Button>
            {userResult?.authorized === false ? (
              <span className="text-sm text-st-muted">Authentication required.</span>
            ) : (
              <span className="text-sm text-st-muted">Creates a raw users-table document, with optional password sign-in.</span>
            )}
          </div>
        </form>
        {error !== null ? <p className="text-sm text-red-300">{error}</p> : null}
        {success !== null ? <p className="text-sm text-emerald-300">{success}</p> : null}
      </Card>

      {passwordUser !== null ? (
        <Card className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">
              {passwordUser.hasPasswordAccount ? "Reset Password Sign-In" : "Enable Password Sign-In"}
            </h2>
            <p className="mt-1 text-sm text-st-muted">
              {passwordUser.email ?? passwordUser.name ?? passwordUser._id}
            </p>
          </div>
          <form className="flex flex-col gap-3 md:flex-row" onSubmit={(event) => void onSetUserPassword(event)}>
            <input
              type="password"
              name="setPassword"
              minLength={8}
              required
              autoFocus
              placeholder="New password"
              className="w-full rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={passwordSubmitting}>
                {passwordSubmitting ? "Saving..." : passwordUser.hasPasswordAccount ? "Reset password" : "Set password"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setPasswordUser(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-st-muted">Users Table</h2>
          <p className="mt-1 text-sm text-st-muted">Showing the latest 100 rows from the Convex users table.</p>
        </div>

        {userResult === undefined ? (
          <p className="rounded-lg border border-st-border bg-st-bg px-3 py-4 text-sm text-st-muted">
            Loading users...
          </p>
        ) : !userResult.authorized ? (
          <p className="rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-4 text-sm text-amber-200">
            Authentication required.
          </p>
        ) : userResult.users.length === 0 ? (
          <p className="rounded-lg border border-st-border bg-st-bg px-3 py-4 text-sm text-st-muted">
            No users found.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-st-muted">
                  <th className="border-b border-st-border px-3 py-2 font-medium">User ID</th>
                  <th className="border-b border-st-border px-3 py-2 font-medium">Created</th>
                  <th className="border-b border-st-border px-3 py-2 font-medium">Name</th>
                  <th className="border-b border-st-border px-3 py-2 font-medium">Email</th>
                  <th className="border-b border-st-border px-3 py-2 font-medium">Phone</th>
                  <th className="border-b border-st-border px-3 py-2 font-medium">Email Verified</th>
                  <th className="border-b border-st-border px-3 py-2 font-medium">Phone Verified</th>
                  <th className="border-b border-st-border px-3 py-2 font-medium">Password Sign-In</th>
                  <th className="border-b border-st-border px-3 py-2 font-medium">Anonymous</th>
                  <th className="border-b border-st-border px-3 py-2 font-medium">Image</th>
                  <th className="border-b border-st-border px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {userResult.users.map((user: AdminUserRow) => (
                  <tr key={user._id} className="align-top">
                    <td className="border-b border-st-border/60 px-3 py-2">
                      <code className="break-all rounded bg-st-bg px-1.5 py-0.5 text-xs text-st-fg">
                        {user._id}
                      </code>
                    </td>
                    <td className="border-b border-st-border/60 px-3 py-2 text-st-muted">
                      {formatTimestamp(user.createdAt)}
                    </td>
                    <td className="border-b border-st-border/60 px-3 py-2 text-st-fg">
                      {user.name ?? "-"}
                    </td>
                    <td className="border-b border-st-border/60 px-3 py-2 text-st-fg">
                      {user.email ?? "-"}
                    </td>
                    <td className="border-b border-st-border/60 px-3 py-2">
                      <div className="text-st-fg">{user.phone ?? "-"}</div>
                    </td>
                    <td className="border-b border-st-border/60 px-3 py-2 text-st-fg">
                      {formatOptionalTimestamp(user.emailVerificationTime)}
                    </td>
                    <td className="border-b border-st-border/60 px-3 py-2 text-st-fg">
                      {formatOptionalTimestamp(user.phoneVerificationTime)}
                    </td>
                    <td className="border-b border-st-border/60 px-3 py-2 text-st-fg">
                      {user.hasPasswordAccount ? "Yes" : "No"}
                    </td>
                    <td className="border-b border-st-border/60 px-3 py-2 text-st-fg">
                      {user.isAnonymous ? "Yes" : "No"}
                    </td>
                    <td className="border-b border-st-border/60 px-3 py-2 text-st-fg">
                      {user.image ?? "-"}
                    </td>
                    <td className="border-b border-st-border/60 px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="px-2 py-1 text-xs"
                          disabled={user.email === null}
                          onClick={() => setPasswordUser(user)}
                        >
                          {user.hasPasswordAccount ? "Reset password" : "Set password"}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="px-2 py-1 text-xs text-red-200 hover:border-red-400 hover:text-red-100"
                          disabled={deletingUserId === user._id}
                          onClick={() => void onDeleteUser(user)}
                        >
                          {deletingUserId === user._id ? "Deleting..." : "Delete"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}