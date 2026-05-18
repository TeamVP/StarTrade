import { FormEvent, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Copy, Pencil, Trash2 } from "lucide-react";
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
  admin: boolean;
  publisher: boolean;
  plan: "free" | "pro";
  hasPasswordAccount: boolean;
};

type AdminUserFormDefaults = {
  name: string;
  email: string;
  phone: string;
  image: string;
  plan: "free" | "pro";
  password: string;
  isAnonymous: boolean;
  admin: boolean;
  publisher: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
};

type AdminUserMutationFields = {
  name: string | null;
  email: string | null;
  phone: string | null;
  image: string | null;
  plan: "free" | "pro";
  isAnonymous: boolean;
  admin: boolean;
  publisher: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
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

async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator === "undefined" || navigator.clipboard?.writeText === undefined) {
    throw new Error("Clipboard access is unavailable in this browser.");
  }
  await navigator.clipboard.writeText(text);
}

function readAdminUserMutationFields(formData: FormData): AdminUserMutationFields {
  const name = stringFromFormData(formData, "name").trim();
  const email = stringFromFormData(formData, "email").trim();
  const phone = stringFromFormData(formData, "phone").trim();
  const image = stringFromFormData(formData, "image").trim();

  return {
    name: name.length > 0 ? name : null,
    email: email.length > 0 ? email : null,
    phone: phone.length > 0 ? phone : null,
    image: image.length > 0 ? image : null,
    plan: formData.get("plan") === "pro" ? "pro" : "free",
    isAnonymous: formData.get("isAnonymous") === "on",
    admin: formData.get("admin") === "on",
    publisher: formData.get("publisher") === "on",
    emailVerified: formData.get("emailVerified") === "on",
    phoneVerified: formData.get("phoneVerified") === "on",
  };
}

function adminUserFormDefaultsFromUser(user: AdminUserRow): AdminUserFormDefaults {
  return {
    name: user.name ?? "",
    email: user.email ?? "",
    phone: user.phone ?? "",
    image: user.image ?? "",
    plan: user.plan,
    password: "",
    isAnonymous: user.isAnonymous,
    admin: user.admin,
    publisher: user.publisher,
    emailVerified: user.emailVerificationTime !== null,
    phoneVerified: user.phoneVerificationTime !== null,
  };
}

function AdminUserModal(props: {
  title: string;
  description: string;
  submitLabel: string;
  submittingLabel: string;
  submitting: boolean;
  includePassword: boolean;
  error: string | null;
  defaults: AdminUserFormDefaults;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDelete?: () => void;
  deleteDisabled?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 py-6">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-xl border border-st-border bg-st-panel shadow-2xl shadow-black/40">
        <div className="flex items-start justify-between gap-4 border-b border-st-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-st-fg">{props.title}</h2>
            <p className="mt-1 text-sm text-st-muted">{props.description}</p>
          </div>
          <Button type="button" variant="secondary" onClick={props.onClose} disabled={props.submitting}>
            Close
          </Button>
        </div>

        <form className="space-y-4 px-5 py-4" onSubmit={(event) => props.onSubmit(event)}>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm text-st-muted">
              <span>Name</span>
              <input
                type="text"
                name="name"
                defaultValue={props.defaults.name}
                placeholder="Optional"
                autoFocus
                className="w-full rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
              />
            </label>
            <label className="space-y-1 text-sm text-st-muted">
              <span>Email</span>
              <input
                type="email"
                name="email"
                defaultValue={props.defaults.email}
                placeholder="Optional"
                className="w-full rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
              />
            </label>
            <label className="space-y-1 text-sm text-st-muted">
              <span>Phone</span>
              <input
                type="text"
                name="phone"
                defaultValue={props.defaults.phone}
                placeholder="Optional"
                className="w-full rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
              />
            </label>
            <label className="space-y-1 text-sm text-st-muted">
              <span>Image URL</span>
              <input
                type="text"
                name="image"
                defaultValue={props.defaults.image}
                placeholder="Optional"
                className="w-full rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
              />
            </label>
            <label className="space-y-1 text-sm text-st-muted">
              <span>Plan</span>
              <select
                name="plan"
                defaultValue={props.defaults.plan}
                className="w-full rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
              >
                <option value="free">Free</option>
                <option value="pro">Pro</option>
              </select>
            </label>
            {props.includePassword ? (
              <label className="space-y-1 text-sm text-st-muted md:col-span-2">
                <span>Password</span>
                <input
                  type="password"
                  name="password"
                  minLength={8}
                  defaultValue={props.defaults.password}
                  placeholder="Optional; leave blank for a table-only user"
                  className="w-full rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-fg"
                />
              </label>
            ) : null}
            <div className="md:col-span-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <label className="flex items-center gap-2 rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
                <input
                  type="checkbox"
                  name="isAnonymous"
                  defaultChecked={props.defaults.isAnonymous}
                  className="accent-cyan-400"
                />
                <span>Anonymous</span>
              </label>
              <label className="flex items-center gap-2 rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
                <input
                  type="checkbox"
                  name="emailVerified"
                  defaultChecked={props.defaults.emailVerified}
                  className="accent-cyan-400"
                />
                <span>Set email verified now</span>
              </label>
              <label className="flex items-center gap-2 rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
                <input
                  type="checkbox"
                  name="phoneVerified"
                  defaultChecked={props.defaults.phoneVerified}
                  className="accent-cyan-400"
                />
                <span>Set phone verified now</span>
              </label>
              <label className="flex items-center gap-2 rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
                <input
                  type="checkbox"
                  name="admin"
                  defaultChecked={props.defaults.admin}
                  className="accent-cyan-400"
                />
                <span>Admin?</span>
              </label>
              <label className="flex items-center gap-2 rounded border border-st-border bg-st-bg px-3 py-2 text-sm text-st-muted">
                <input
                  type="checkbox"
                  name="publisher"
                  defaultChecked={props.defaults.publisher}
                  className="accent-cyan-400"
                />
                <span>Publisher?</span>
              </label>
            </div>
          </div>

          {props.error !== null ? <p className="text-sm text-red-300">{props.error}</p> : null}

          <div className="flex items-center justify-between gap-2">
            <div>
              {props.onDelete ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="px-2 py-2 text-red-200 hover:text-red-100"
                  aria-label="Delete user"
                  title="Delete user"
                  disabled={props.deleteDisabled}
                  onClick={props.onDelete}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={props.onClose} disabled={props.submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={props.submitting}>
                {props.submitting ? props.submittingLabel : props.submitLabel}
              </Button>
            </div>
          </div>
        </form>
      </div>

      <button
        type="button"
        aria-label="Close user modal"
        className="absolute inset-0 -z-10"
        onClick={props.onClose}
      />
    </div>
  );
}

export function AdminUsersPage() {
  const userResult = useQuery(api.admin.queries.listUsers, { limit: 100 });
  const createUser = useMutation(api.admin.mutations.createUser);
  const updateUser = useMutation(api.admin.mutations.updateUser);
  const setUserPassword = useMutation(api.admin.mutations.setUserPassword);
  const deleteUser = useMutation(api.admin.mutations.deleteUser);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<Id<"users"> | null>(null);
  const [passwordUser, setPasswordUser] = useState<AdminUserRow | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUserRow | null>(null);
  const [deleteConfirmUser, setDeleteConfirmUser] = useState<AdminUserRow | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function onCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (userResult?.authorized === false) {
      setModalError("Authentication required.");
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    const fields = readAdminUserMutationFields(formData);
    const password = stringFromFormData(formData, "password");

    setCreateSubmitting(true);
    setModalError(null);
    setSuccess(null);
    try {
      await createUser({
        ...fields,
        password: password.trim().length > 0 ? password : null,
      });
      form.reset();
      setCreateModalOpen(false);
      setSuccess(
        password.trim().length > 0
          ? "Created user record with password sign-in."
          : "Created user record.",
      );
    } catch (createError) {
      setModalError(mutationErrorMessage(createError));
    } finally {
      setCreateSubmitting(false);
    }
  }

  async function onEditUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editingUser === null) {
      return;
    }
    if (userResult?.authorized === false) {
      setModalError("Authentication required.");
      return;
    }

    const formData = new FormData(event.currentTarget);
    const fields = readAdminUserMutationFields(formData);
    const label = editingUser.email ?? editingUser.name ?? editingUser._id;

    setEditSubmitting(true);
    setModalError(null);
    setSuccess(null);
    try {
      await updateUser({
        userId: editingUser._id,
        ...fields,
      });
      setEditingUser(null);
      setSuccess(`Updated user ${label}.`);
    } catch (updateError) {
      setModalError(mutationErrorMessage(updateError));
    } finally {
      setEditSubmitting(false);
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

  async function onCopyUserId(user: AdminUserRow) {
    setError(null);
    setSuccess(null);
    try {
      await copyTextToClipboard(user._id);
      setSuccess(`Copied user id for ${user.email ?? user.name ?? user._id}.`);
    } catch (copyError) {
      setError(mutationErrorMessage(copyError));
    }
  }

  async function onDeleteUser(user: AdminUserRow) {
    const label = user.email ?? user.name ?? user._id;

    setDeletingUserId(user._id);
    setModalError(null);
    setError(null);
    setSuccess(null);
    try {
      await deleteUser({ userId: user._id });
      setDeleteConfirmUser(null);
      setEditingUser((current) => (current?._id === user._id ? null : current));
      setSuccess(`Deleted user ${label}.`);
    } catch (deleteError) {
      const message = mutationErrorMessage(deleteError);
      setModalError(message);
      setError(message);
    } finally {
      setDeletingUserId(null);
    }
  }

  return (
    <div className="mx-auto max-w-[86.4rem] space-y-6 px-4 py-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-st-fg">Users</h1>
          <p className="text-sm text-st-muted">
            View, create, and edit records in the Convex <span className="font-mono text-st-fg">users</span> table.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => {
            setModalError(null);
            setCreateModalOpen(true);
          }}
          disabled={userResult?.authorized === false}
        >
          Create new user
        </Button>
      </div>

      {error !== null ? <p className="text-sm text-red-300">{error}</p> : null}
      {success !== null ? <p className="text-sm text-emerald-300">{success}</p> : null}

      {createModalOpen ? (
        <AdminUserModal
          title="Create User"
          description="Insert a new users-table row and optionally provision password sign-in at the same time."
          submitLabel="Create user"
          submittingLabel="Creating..."
          submitting={createSubmitting}
          includePassword
          error={modalError}
          defaults={{
            name: "",
            email: "",
            phone: "",
            image: "",
            plan: "free",
            password: "",
            isAnonymous: false,
            admin: false,
            publisher: false,
            emailVerified: false,
            phoneVerified: false,
          }}
          onClose={() => {
            if (createSubmitting) {
              return;
            }
            setModalError(null);
            setCreateModalOpen(false);
          }}
          onSubmit={(event) => void onCreateUser(event)}
        />
      ) : null}

      {editingUser !== null ? (
        <AdminUserModal
          key={editingUser._id}
          title="Edit User"
          description="Update the stored user details. Password sign-in stays on the existing separate action."
          submitLabel="Save changes"
          submittingLabel="Saving..."
          submitting={editSubmitting}
          includePassword={false}
          error={modalError}
          defaults={adminUserFormDefaultsFromUser(editingUser)}
          onClose={() => {
            if (editSubmitting) {
              return;
            }
            setModalError(null);
            setDeleteConfirmUser(null);
            setEditingUser(null);
          }}
          onSubmit={(event) => void onEditUser(event)}
          onDelete={() => {
            setModalError(null);
            setDeleteConfirmUser(editingUser);
          }}
          deleteDisabled={editSubmitting || deletingUserId === editingUser._id}
        />
      ) : null}

      {deleteConfirmUser !== null ? (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/80 px-4 py-6">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-xl border border-st-border bg-st-panel p-5 shadow-2xl shadow-black/40"
          >
            <h2 className="text-base font-semibold text-st-fg">Delete user?</h2>
            <p className="mt-2 text-sm text-st-muted">
              This removes the users row and linked auth/profile records for {deleteConfirmUser.email ?? deleteConfirmUser.name ?? deleteConfirmUser._id}.
            </p>
            {modalError !== null ? <p className="mt-3 text-sm text-red-300">{modalError}</p> : null}
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={deletingUserId === deleteConfirmUser._id}
                onClick={() => {
                  setModalError(null);
                  setDeleteConfirmUser(null);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="outline"
                className="border-red-400 text-red-200 hover:border-red-300 hover:text-red-100"
                disabled={deletingUserId === deleteConfirmUser._id}
                onClick={() => void onDeleteUser(deleteConfirmUser)}
              >
                {deletingUserId === deleteConfirmUser._id ? "Deleting..." : "Delete user"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

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
                  <th className="border-b border-st-border px-3 py-2 font-medium">Pwd Sign-In</th>
                  <th className="border-b border-st-border px-3 py-2 font-medium">Plan</th>
                  <th className="border-b border-st-border px-3 py-2 font-medium">Anon</th>
                  <th className="border-b border-st-border px-3 py-2 font-medium">Admin</th>
                  <th className="border-b border-st-border px-3 py-2 font-medium">Image</th>
                  <th className="border-b border-st-border px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {userResult.users.map((user: AdminUserRow) => (
                  <tr key={user._id} className="align-top">
                    <td className="border-b border-st-border/60 px-3 py-2">
                      <Button
                        type="button"
                        variant="ghost"
                        className="px-2 py-1"
                        aria-label={`Copy user id for ${user.email ?? user.name ?? user._id}`}
                        title="Copy user id"
                        onClick={() => void onCopyUserId(user)}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
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
                      {user.plan === "pro" ? "Pro" : "Free"}
                    </td>
                    <td className="border-b border-st-border/60 px-3 py-2 text-st-fg">
                      {user.isAnonymous ? "Yes" : "No"}
                    </td>
                    <td className="border-b border-st-border/60 px-3 py-2 text-st-fg">
                      {user.admin ? "Yes" : "-"}
                    </td>
                    <td className="border-b border-st-border/60 px-3 py-2 text-st-fg">
                      {user.image ?? "-"}
                    </td>
                    <td className="border-b border-st-border/60 px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          className="px-2 py-1"
                          aria-label={`Edit ${user.email ?? user.name ?? user._id}`}
                          title="Edit user"
                          onClick={() => {
                            setModalError(null);
                            setEditingUser(user);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="px-2 py-1 text-xs"
                          disabled={user.email === null}
                          onClick={() => setPasswordUser(user)}
                        >
                          {user.hasPasswordAccount ? "Reset password" : "Set password"}
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