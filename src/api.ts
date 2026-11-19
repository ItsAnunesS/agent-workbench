import { invoke as nativeInvoke, type InvokeArgs } from "@tauri-apps/api/core";
import { getLocale } from "./i18n";

export function invoke<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return nativeInvoke<T>(command, {
    ...args,
    locale: getLocale(),
  } as InvokeArgs);
}
