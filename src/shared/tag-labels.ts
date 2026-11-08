/** A repo tag as the browser receives it. */
export interface TagRef {
  name: string;
  key: string;
  /** The main repo's parent folder name; absent on tags stored before it existed. */
  parent?: string;
}

/** The shortest key start shown beside a repo name that another repo shares. */
const MIN_KEY_START = 4;

/**
 * Works out how each repo tag is written wherever it is shown.
 * @param tags - Every live tag of one company; duplicates are fine.
 * @returns The label of each tag key: the repo name; when another tag of the company shares the name, `parent/name`, or the repo name with the start of its key where the parent is unknown or does not tell them apart.
 */
export function tagLabels(tags: Iterable<TagRef>): Map<string, string> {
  const keysByName = new Map<string, Set<string>>();
  const parents = new Map<string, string | undefined>();
  for (const { name, key, parent } of tags) {
    keysByName.set(name, (keysByName.get(name) ?? new Set()).add(key));
    parents.set(key, parent);
  }
  const labels = new Map<string, string>();
  for (const [name, keySet] of keysByName) {
    const keys = [...keySet];
    if (keys.length === 1) {
      labels.set(keys[0] as string, name);
      continue;
    }
    // Without a usable parent, same-named repos are told apart by how much of the key is shown.
    let length = MIN_KEY_START;
    while (
      new Set(keys.map((key) => key.slice(0, length))).size < keys.length &&
      length < Math.max(...keys.map((key) => key.length))
    ) {
      length++;
    }
    const byParent = keys.map((key) => {
      const parent = parents.get(key);
      return parent ? `${parent}/${name}` : null;
    });
    for (const [i, key] of keys.entries()) {
      const parented = byParent[i];
      // A parent/name that another same-named repo shares would not tell them apart.
      const unique =
        parented && byParent.filter((l) => l === parented).length === 1;
      labels.set(key, unique ? parented : `${name}~${key.slice(0, length)}`);
    }
  }
  return labels;
}
