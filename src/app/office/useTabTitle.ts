import { useEffect } from "react";

const NAME = "Claude Office";

/**
 * Shows how many employees need the owner in the browser tab's title.
 * @param count - Employees that need the owner.
 * @param enabled - Whether the tab shows the count.
 */
export function useTabTitle(count: number, enabled = true): void {
  const title = enabled && count > 0 ? `(${count}) ${NAME}` : NAME;
  useEffect(() => {
    // An answer every few seconds must not rewrite an unchanged title
    if (document.title !== title) document.title = title;
  }, [title]);
  // The page's own title comes back when the office goes away
  useEffect(
    () => () => {
      document.title = NAME;
    },
    [],
  );
}
