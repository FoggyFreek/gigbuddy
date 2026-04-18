# React Calls Components and Hooks

Source: https://react.dev/reference/rules/react-calls-components-and-hooks

React — not your code — is responsible for deciding when a component function runs and when a Hook is evaluated. This is what makes React declarative.

---

## Rule 1 — Never call component functions directly

Use components only in JSX. Never invoke them as plain functions.

```tsx
// GOOD — React decides when to call Article and Layout
function BlogPost() {
  return (
    <Layout>
      <Article />
    </Layout>
  );
}

// BAD — you are calling Article directly, bypassing React
function BlogPost() {
  return <Layout>{Article()}</Layout>;
}
```

**Why React must be in control:**

| Benefit | Explanation |
|---|---|
| Local state via Hooks | React ties Hook state to the component's position in the tree. Direct calls break this link. |
| Reconciliation | React uses component type identity to decide whether to reuse or remount. Calling directly strips this information. |
| Concurrent features | React can split rendering across frames (Concurrent Mode). Direct calls block this optimization. |
| DevTools | Components called as JSX show up in React DevTools; directly called functions don't. |
| Selective re-rendering | React can skip re-rendering components whose props haven't changed. Direct calls skip this check. |

**Hooks inside directly called components break the Rules of Hooks:**

```tsx
// If Condition calls Component() directly and Component contains Hooks,
// those Hooks are now called conditionally — violating Rule 1 of Hooks.
function Condition({ show }: { show: boolean }) {
  return show ? Component() : null; // BAD — Hooks inside may be called conditionally
  return show ? <Component /> : null; // GOOD — React manages the call
}
```

---

## Rule 2 — Never pass Hooks around as values

Hooks must always be called directly and inline. They must not be stored in variables and passed to other components, returned from functions for later invocation, or wrapped by higher-order functions.

### Don't pass Hooks as props

```tsx
// BAD — Hook passed as a prop
function ChatInput() {
  return <Button useData={useDataWithLogging} />;
}

function Button({ useData }: { useData: () => Data }) {
  const data = useData(); // Rules of Hooks violation — dynamic call
}

// GOOD — call the Hook directly inside the component that needs it
function ChatInput() {
  return <Button />;
}

function Button() {
  const data = useDataWithLogging(); // ✓ called at top level, statically
}
```

### Don't write higher-order Hooks

```tsx
// BAD — wrapping a Hook in a higher-order function
function ChatInput() {
  const useDataWithLogging = withLogging(useData); // dynamic Hook creation
  const data = useDataWithLogging();
}

// GOOD — define the composed Hook statically outside the component
function useDataWithLogging() {
  const data = useData();
  useEffect(() => { log(data); }, [data]);
  return data;
}

function ChatInput() {
  const data = useDataWithLogging(); // ✓
}
```

### Don't store Hooks in variables for dynamic dispatch

```tsx
// BAD — selecting a Hook at runtime
function Feed({ isLoggedIn }: { isLoggedIn: boolean }) {
  const useDataHook = isLoggedIn ? usePrivateData : usePublicData;
  const data = useDataHook(); // Hook identity changes between renders
}

// GOOD — handle the condition inside the Hook or component logic
function Feed({ isLoggedIn }: { isLoggedIn: boolean }) {
  const data = isLoggedIn ? usePrivateData() : usePublicData();
  // Still BAD if isLoggedIn can change — use a single Hook with a parameter instead:
}

function useFeedData(isLoggedIn: boolean) {
  const privateData = usePrivateData();
  const publicData = usePublicData();
  return isLoggedIn ? privateData : publicData;
}
```

**Why:** React needs static, predictable Hook call graphs to:
- Enforce call-order stability (Rules of Hooks)
- Enable correct memoization
- Support local reasoning — a developer reading a component should be able to see exactly which Hooks it uses without following dynamic dispatch chains
