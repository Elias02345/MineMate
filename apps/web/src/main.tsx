import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { I18nProvider } from "./i18n.tsx";
import { AuthGate } from "./Auth.tsx";
import { Shell } from "./Shell.tsx";
import { Dashboard } from "./Dashboard.tsx";
import { ServerPage } from "./ServerPage.tsx";
import { UsersPage } from "./UsersPage.tsx";
import { SettingsPage } from "./SettingsPage.tsx";
import { NotificationsPage } from "./NotificationsPage.tsx";
import { ErrorBoundary } from "./ErrorBoundary.tsx";
import { Experience } from "./Experience.tsx";
import "./styles.css";
import "./adventure.css";
import "./responsive.css";
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5000, retry: 1, refetchOnWindowFocus: false },
  },
});
const rootRoute = createRootRoute({
  component: () => (
    <AuthGate>
      <Shell />
    </AuthGate>
  ),
});
const routeTree = rootRoute.addChildren([
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: Dashboard,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/servers/$serverId",
    component: ServerPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/users",
    component: UsersPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    component: SettingsPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/notifications",
    component: NotificationsPage,
  }),
]);
const router = createRouter({ routeTree, defaultPreload: "intent" });
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <Experience>
          <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
          </QueryClientProvider>
        </Experience>
      </I18nProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
