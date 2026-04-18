# Purity and Rendering Rules

Source: https://react.dev/reference/rules/components-and-hooks-must-be-pure

## Why purity matters

React may render a component multiple times. If render has side effects, they fire unexpectedly and cause bugs. Pure render = React can safely retry, defer, or batch renders for performance.

React has three phases:
1. **Render** — calculate next UI (must be pure)
2. **Commit** — apply minimal DOM changes
3. **Effects** — run `useEffect` callbacks after paint

Code at the top level of a component runs during **render**. Event handlers and `useEffect` do not.

---

## Rule 1 — Components must be idempotent

Same inputs (props, state, context) must always produce the same output.

```tsx
// BAD — new Date() is not idempotent
function Clock() {
  const time = new Date();
  return <span>{time.toLocaleString()}</span>;
}

// GOOD — move non-idempotent logic into an Effect
function useTime() {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}
function Clock() {
  const time = useTime();
  return <span>{time.toLocaleString()}</span>;
}
```

Other non-idempotent values to keep out of render: `Math.random()`, `Date.now()`, `crypto.randomUUID()` (unless used for initial state via lazy init).

---

## Rule 2 — Side effects must run outside render

Side effects include: network requests, subscriptions, DOM mutations, writing to refs, logging, writing to module-level variables.

**Where side effects belong:**
- Event handlers (`onClick`, `onChange`, …)
- `useEffect` / `useLayoutEffect`

```tsx
// BAD — fetch in render body
function Profile({ userId }: { userId: string }) {
  const data = fetch(`/api/users/${userId}`).then(r => r.json()); // runs on every render!
  return <div>{data.name}</div>;
}

// GOOD — fetch in useEffect (or use a data-fetching hook)
function Profile({ userId }: { userId: string }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    fetch(`/api/users/${userId}`).then(r => r.json()).then(setData);
  }, [userId]);
  return <div>{data?.name}</div>;
}

// BAD — DOM mutation in render
function Title({ text }: { text: string }) {
  document.title = text; // runs on every render, before paint
  return <h1>{text}</h1>;
}

// GOOD
function Title({ text }: { text: string }) {
  useEffect(() => { document.title = text; }, [text]);
  return <h1>{text}</h1>;
}
```

**Local mutation is fine** — creating and mutating a variable within the same render is not a side effect:

```tsx
// GOOD — items is local to this render
function List({ items }: { items: string[] }) {
  const nodes: ReactNode[] = [];
  for (const item of items) {
    nodes.push(<li key={item}>{item}</li>);
  }
  return <ul>{nodes}</ul>;
}

// BAD — mutates a value created outside the component
const nodes: ReactNode[] = [];
function List({ items }: { items: string[] }) {
  for (const item of items) {
    nodes.push(<li key={item}>{item}</li>); // accumulates across renders!
  }
  return <ul>{nodes}</ul>;
}
```

---

## Rule 3 — Props and state are immutable

Props and state are read-only snapshots for the current render. Never mutate them.

```tsx
// BAD — mutating props
function Post({ item }: { item: { url: string; title: string } }) {
  item.url = normalize(item.url); // mutates the caller's object
  return <a href={item.url}>{item.title}</a>;
}

// GOOD — derive a new value
function Post({ item }: { item: { url: string; title: string } }) {
  const url = normalize(item.url);
  return <a href={url}>{item.title}</a>;
}

// BAD — mutating state
function Counter() {
  const [count, setCount] = useState(0);
  function handleClick() {
    count = count + 1; // does not trigger a re-render
  }
  return <button onClick={handleClick}>{count}</button>;
}

// GOOD
function Counter() {
  const [count, setCount] = useState(0);
  function handleClick() {
    setCount(count + 1);
  }
  return <button onClick={handleClick}>{count}</button>;
}
```

For objects/arrays in state always produce a new reference:

```tsx
// BAD
setState(prev => { prev.items.push(newItem); return prev; });

// GOOD
setState(prev => ({ ...prev, items: [...prev.items, newItem] }));
```

---

## Rule 4 — Hook arguments and return values are immutable

Once a value is passed to a Hook, treat it as frozen. Hook return values should also be treated as read-only (they may be memoized).

```tsx
// BAD — mutating a Hook argument
function useIconStyle(icon: Icon) {
  const theme = useContext(ThemeContext);
  if (icon.enabled) {
    icon.className = computeStyle(icon, theme); // mutates caller's object
  }
  return icon;
}

// GOOD — copy first
function useIconStyle(icon: Icon) {
  const theme = useContext(ThemeContext);
  return useMemo(() => {
    const next = { ...icon };
    if (icon.enabled) next.className = computeStyle(icon, theme);
    return next;
  }, [icon, theme]);
}
```

If you mutate a memoized return value or a Hook argument after the call, memoization will return a stale value on the next render.

---

## Rule 5 — Values are immutable after being passed to JSX

Don't mutate an object after it has been used in JSX — React may have already evaluated it.

```tsx
// BAD
function Page({ colour }: { colour: string }) {
  const styles = { colour, size: 'large' };
  const header = <Header styles={styles} />;
  styles.size = 'small'; // Header may have already consumed the old value
  const footer = <Footer styles={styles} />;
  return <>{header}<footer /></>;
}

// GOOD — separate objects
function Page({ colour }: { colour: string }) {
  const header = <Header styles={{ colour, size: 'large' }} />;
  const footer = <Footer styles={{ colour, size: 'small' }} />;
  return <>{header}<footer /></>;
}
```
