import { lazy, Suspense, useEffect } from 'react';
import { ConfirmHost, PromptHost, Toaster, TooltipProvider } from './ui';
import { useApp } from './lib/store';
import { useRoute } from './lib/router';
import { LibraryPage } from './pages/library/LibraryPage';

const EditorPage = lazy(() => import('./pages/editor/EditorPage'));

export function App() {
  const route = useRoute();
  const { loaded, load } = useApp();

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <TooltipProvider>
      {!loaded ? (
        <div className="boot" aria-busy="true">
          <span className="spinner" />
        </div>
      ) : route.name === 'editor' ? (
        <Suspense
          fallback={
            <div className="boot" aria-busy="true">
              <span className="spinner" />
            </div>
          }
        >
          <EditorPage key={route.id} id={route.id} initialFile={route.file} />
        </Suspense>
      ) : (
        <LibraryPage />
      )}
      <Toaster />
      <ConfirmHost />
      <PromptHost />
    </TooltipProvider>
  );
}
