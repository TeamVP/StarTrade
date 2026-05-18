import { action } from "../_generated/server";
import { v } from "convex/values";
import { api } from "../_generated/api";

export const uploadMyAvatar = action({
  args: {
    dataUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) {
      throw new Error("Authentication required.");
    }

    const matches = args.dataUrl.match(/^data:([A-Za-z0-9/+.-]+);base64,(.+)$/);
    if (matches === null) {
      throw new Error("Invalid image payload.");
    }

    const [, contentType, base64Data] = matches;
    if (!contentType.startsWith("image/")) {
      throw new Error("Avatar uploads must be image files.");
    }

    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let index = 0; index < binaryString.length; index += 1) {
      bytes[index] = binaryString.charCodeAt(index);
    }

    const blob = new Blob([bytes], { type: contentType });
    if (blob.size > 5 * 1024 * 1024) {
      throw new Error("Avatar image must be smaller than 5 MB.");
    }

    const storageId = await ctx.storage.store(blob);

    try {
      const avatarUrl = await ctx.storage.getUrl(storageId);
      if (avatarUrl === null) {
        throw new Error("Unable to resolve uploaded avatar.");
      }

      const profileId: string = await ctx.runMutation(api.usr.mutations.replaceMyAvatar, {
        storageId,
        avatarUrl,
      });

      return { profileId, avatarUrl };
    } catch (error) {
      await ctx.storage.delete(storageId);
      throw error;
    }
  },
});