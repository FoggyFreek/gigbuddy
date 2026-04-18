# Rules of Hooks

Source: https://react.dev/reference/rules/rules-of-hooks

Hooks are JavaScript functions with special restrictions on where they can be called. Violating these rules breaks Hook identity across renders, causing stale state, incorrect behavior, and hard-to-trace bugs.

---

## Rule 1 — Only call Hooks at the top level

Call Hooks unconditionally, at the top of a function component or custom Hook body, before any early returns.

**Never call Hooks inside:**
- `if` / `else` / ternary conditions
- `for` / `while` loops
- Nested functions (including callbacks)
- `try` / `catch` / `finally` blocks
- After a conditional `return`
- Event handlers
- Class component `render()`
- `useMemo`, `useReducer`, or `useEffect` callbacks

```tsx
// GOOD
function Counter() {
  const [count, setCount] = useState(0);         // top level ✓
  const theme = useContext(ThemeContext);          // top level ✓
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}

// BAD — inside a condition
function BadComponent({ show }: { show: boolean }) {
  if (show) {
    const [value, setValue] = useState(''); // Hook order changes when `show` changes
  }
}

// BAD — inside a loop
function BadList({ items }: { items: string[] }) {
  for (const item of items) {
    const [selected, setSelected] = useState(false); // Hook count varies
  }
}

// BAD — after a conditional return
function BadEarly({ cond }: { cond: boolean }) {
  if (cond) return null;
  const [x, setX] = useState(0); // Hook is skipped when cond is true
}

// GOOD — move the Hook before the return
function GoodEarly({ cond }: { cond: boolean }) {
  const [x, setX] = useState(0);
  if (cond) return null;
  return <div>{x}</div>;
}

// BAD — inside useEffect callback
function BadEffect() {
  useEffect(() => {
    const [x, setX] = useState(0); // Hooks cannot be called inside callbacks
  }, []);
}

// BAD — inside try/catch
function BadTryCatch() {
  try {
    const [x, setX] = useState(0);
  } catch {
    const [x, setX] = useState(1); // Two conditional Hook calls
  }
}
```

**Why:** React tracks Hooks by call order. Calling Hooks conditionally changes the order between renders, corrupting the internal Hook chain.

---

## Rule 2 — Only call Hooks from React functions

Valid call sites:
1. **Function components** — any function used as a JSX component
2. **Custom Hooks** — functions whose names start with `use`

```tsx
// GOOD — function component
function FriendList() {
  const status = useOnlineStatus(); // ✓
  return <div>{status}</div>;
}

// GOOD — custom Hook calling another Hook
function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(true); // ✓ (inside a custom Hook)
  useEffect(() => {
    // ...
  }, []);
  return isOnline;
}

// BAD — plain JS function (not a component, not a custom Hook)
function getStatus() {
  const [status] = useOnlineStatus(); // runtime error / violates rules
  return status;
}
```

**Why:** React needs to associate Hook state with a component. Calling Hooks outside a component means there's no component to attach state to.

---

## Custom Hooks — the right place to share stateful logic

Custom Hooks (functions starting with `use`) follow the same rules as built-in Hooks. Their purpose is to encapsulate and share stateful logic across components.

```tsx
// Good pattern — custom Hook encapsulates stateful logic
function useWindowWidth() {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return width;
}

function MyComponent() {
  const width = useWindowWidth(); // ✓ called at top level
  return <div>Window is {width}px wide</div>;
}
```

---

## ESLint enforcement

The `eslint-plugin-react-hooks` plugin (included in most React toolchains) enforces both rules:
- `react-hooks/rules-of-hooks` — flags invalid Hook call sites
- `react-hooks/exhaustive-deps` — flags missing or stale `useEffect` / `useMemo` / `useCallback` dependencies

Prefer fixing the root cause over silencing the lint rule. When a `// eslint-disable` is unavoidable, add a comment explaining why.
