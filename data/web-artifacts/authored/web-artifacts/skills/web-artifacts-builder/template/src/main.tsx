import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';
function App() {
  const [count, setCount] = useState(0);
  return <main className="min-h-screen bg-slate-950 p-8 text-white">
    <h1 className="text-3xl font-bold">Standalone artifact</h1>
    <p className="my-4">A local React component, styled with Tailwind.</p>
    <button className="rounded-lg bg-blue-600 px-4 py-2" onClick={() => setCount(count + 1)}>Count {count}</button>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
