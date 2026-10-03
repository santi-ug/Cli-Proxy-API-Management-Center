import {
  ReactNode,
  RefObject,
  SVGProps,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { PageTransition } from '@/components/common/PageTransition';
import { MainRoutes } from '@/router/MainRoutes';
import { authFilesApi, pluginsApi } from '@/services/api';
import {
  IconSidebarAuthFiles,
  IconSidebarConfig,
  IconSidebarDashboard,
  IconSidebarPools,
  IconSidebarLogs,
  IconSidebarOauth,
  IconSidebarPlugins,
  IconSidebarProviders,
  IconSidebarQuickStart,
  IconSidebarQuota,
  IconSidebarStore,
  IconSidebarSystem,
  IconChevronDown,
} from '@/components/ui/icons';
import { INLINE_LOGO_JPEG } from '@/assets/logoInline';
import {
  useAuthStore,
  useConfigStore,
  useDrawerStore,
  useLanguageStore,
  useNotificationStore,
  useThemeStore,
} from '@/stores';
import { AUTH_FILES_CHANGED_EVENT } from '@/features/authFiles/authFilesEvents';
import {
  collectPluginResourceEntries,
  PLUGIN_RESOURCES_REFRESH_EVENT,
  resolvePluginAssetURL,
  type PluginResourceEntry,
} from '@/features/plugins/pluginResources';
import { APIKEY_FUN_DISPLAY_NAME, hasApiKeyFunConfig } from '@/features/providers/sponsor';
import { triggerHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { LANGUAGE_LABEL_KEYS, LANGUAGE_ORDER } from '@/utils/constants';
import { isSupportedLanguage } from '@/utils/language';
import { isSidebarToggleShortcut } from '@/utils/sidebarShortcut';
import type { Theme } from '@/types';

const sidebarIcons: Record<string, ReactNode> = {
  pools: <IconSidebarPools size={18} />,
  dashboard: <IconSidebarDashboard size={18} />,
  quickStart: <IconSidebarQuickStart size={18} />,
  aiProviders: <IconSidebarProviders size={18} />,
  authFiles: <IconSidebarAuthFiles size={18} />,
  oauth: <IconSidebarOauth size={18} />,
  quota: <IconSidebarQuota size={18} />,
  plugins: <IconSidebarPlugins size={18} />,
  pluginStore: <IconSidebarStore size={18} />,
  config: <IconSidebarConfig size={18} />,
  logs: <IconSidebarLogs size={18} />,
  system: <IconSidebarSystem size={18} />,
};

interface SidebarNavLinkItem {
  kind?: 'link';
  path: string;
  labelKey?: string;
  label?: string;
  badge?: number;
  badgeLabel?: string;
  icon: ReactNode;
}

interface SidebarNavDrawerItem {
  kind: 'drawer';
  id: string;
  label: string;
  icon: ReactNode;
  children: SidebarNavLinkItem[];
}

type SidebarNavItem = SidebarNavLinkItem | SidebarNavDrawerItem;

const DRAWER_ID = 'app-drawer';

interface SidebarNavGroup {
  id: string;
  labelKey: string;
  items: SidebarNavItem[];
}

const flattenNavItems = (items: SidebarNavItem[]): SidebarNavLinkItem[] =>
  items.flatMap((item) => (item.kind === 'drawer' ? item.children : [item]));

/** 点击菜单外或按下 Escape 时关闭弹出菜单 */
function useMenuDismiss(
  open: boolean,
  menuRef: RefObject<HTMLDivElement | null>,
  onClose: () => void
) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open, menuRef, onClose]);
}

function PluginSidebarIcon({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;

  return showImage ? (
    <img src={src} alt="" onError={() => setFailed(true)} />
  ) : (
    <IconSidebarPlugins size={18} />
  );
}

// Header action icons - smaller size for header buttons
const headerIconProps: SVGProps<SVGSVGElement> = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false',
};

const headerIcons = {
  refresh: (
    <svg {...headerIconProps}>
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  ),
  menu: (
    <svg {...headerIconProps}>
      <rect x="3" y="4.5" width="18" height="15" rx="3" />
      <path d="M9 4.5v15" />
    </svg>
  ),
  close: (
    <svg {...headerIconProps}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  ),
  language: (
    <svg {...headerIconProps}>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  sun: (
    <svg {...headerIconProps}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  ),
  moon: (
    <svg {...headerIconProps}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" />
    </svg>
  ),
  whiteTheme: (
    <svg {...headerIconProps}>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
    </svg>
  ),
  autoTheme: (
    <svg {...headerIconProps}>
      <defs>
        <clipPath id="mainLayoutAutoThemeSunLeftHalf">
          <rect x="0" y="0" width="12" height="24" />
        </clipPath>
      </defs>
      <circle cx="12" cy="12" r="4" />
      <circle
        cx="12"
        cy="12"
        r="4"
        clipPath="url(#mainLayoutAutoThemeSunLeftHalf)"
        fill="currentColor"
      />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="M4.93 4.93l1.41 1.41" />
      <path d="M17.66 17.66l1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="M6.34 17.66l-1.41 1.41" />
      <path d="M19.07 4.93l-1.41 1.41" />
    </svg>
  ),
  logout: (
    <svg {...headerIconProps}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  ),
};

const THEME_CARDS: Array<{
  key: Theme;
  labelKey: string;
  colors: { bg: string; card: string; border: string; text: string; textMuted: string };
}> = [
  {
    key: 'auto',
    labelKey: 'theme.auto',
    colors: {
      bg: 'linear-gradient(135deg, #ffffff 0 50%, #111111 50% 100%)',
      card: 'linear-gradient(135deg, #ffffff 0 50%, #1a1a1a 50% 100%)',
      border: '#bdbdbd',
      text: '#2d2a26',
      textMuted: 'linear-gradient(135deg, #c9c9c9 0 50%, #5a5a5a 50% 100%)',
    },
  },
  {
    key: 'white',
    labelKey: 'theme.white',
    colors: {
      bg: '#ffffff',
      card: '#ffffff',
      border: '#e5e5e5',
      text: '#2d2a26',
      textMuted: '#a29c95',
    },
  },
  {
    key: 'light',
    labelKey: 'theme.light',
    colors: {
      bg: '#faf9f5',
      card: '#f0eee8',
      border: '#e3e1db',
      text: '#2d2a26',
      textMuted: '#a29c95',
    },
  },
  {
    key: 'dark',
    labelKey: 'theme.dark',
    colors: {
      bg: '#151412',
      card: '#1d1b18',
      border: '#3a3530',
      text: '#f6f4f1',
      textMuted: '#9c958d',
    },
  },
];

export function MainLayout() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const location = useLocation();

  const logout = useAuthStore((state) => state.logout);
  const keyless = useAuthStore((state) => state.keyless);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);
  const supportsPlugin = useAuthStore((state) => state.supportsPlugin);

  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const clearCache = useConfigStore((state) => state.clearCache);
  const config = useConfigStore((state) => state.config);

  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);

  const drawerOpen = useDrawerStore((state) => state.open);
  const drawerOpener = useDrawerStore((state) => state.opener);
  const openDrawer = useDrawerStore((state) => state.openDrawer);
  const closeDrawer = useDrawerStore((state) => state.closeDrawer);

  const [authFilesCount, setAuthFilesCount] = useState<number | null>(null);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [pluginResources, setPluginResources] = useState<PluginResourceEntry[]>([]);
  const [expandedPluginResourceIDs, setExpandedPluginResourceIDs] = useState<Set<string>>(
    () => new Set()
  );
  const contentRef = useRef<HTMLDivElement | null>(null);
  const authFilesCountRequestRef = useRef(0);
  const languageMenuRef = useRef<HTMLDivElement | null>(null);
  const themeMenuRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const wasDrawerOpenRef = useRef(false);

  const fullBrandName = 'CLI Proxy API Management Center';
  const abbrBrandName = t('title.abbr');
  const isLogsPage = location.pathname.startsWith('/logs');
  const isPluginResourcePage = location.pathname.startsWith('/plugin-pages');
  // The pools page brings its own header with the drawer button and refresh.
  const isPoolsPage = location.pathname === '/';

  // Keep floating header height available to sticky mobile elements and overlays.
  useLayoutEffect(() => {
    const updateHeaderHeight = () => {
      const height = headerRef.current?.offsetHeight;
      if (height) {
        document.documentElement.style.setProperty('--header-height', `${height}px`);
      }
    };

    updateHeaderHeight();

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && headerRef.current
        ? new ResizeObserver(updateHeaderHeight)
        : null;
    if (resizeObserver && headerRef.current) {
      resizeObserver.observe(headerRef.current);
    }

    window.addEventListener('resize', updateHeaderHeight);

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      window.removeEventListener('resize', updateHeaderHeight);
    };
  }, []);

  // Keep the content center available to bottom overlays that align with the main area.
  useLayoutEffect(() => {
    const updateContentCenter = () => {
      const el = contentRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      document.documentElement.style.setProperty('--content-center-x', `${centerX}px`);
    };

    updateContentCenter();

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && contentRef.current
        ? new ResizeObserver(updateContentCenter)
        : null;

    if (resizeObserver && contentRef.current) {
      resizeObserver.observe(contentRef.current);
    }

    window.addEventListener('resize', updateContentCenter);

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      window.removeEventListener('resize', updateContentCenter);
      document.documentElement.style.removeProperty('--content-center-x');
    };
  }, []);

  // Drawer focus: into the first link on open, back to whoever opened it on close.
  useEffect(() => {
    if (drawerOpen) {
      wasDrawerOpenRef.current = true;
      drawerRef.current?.querySelector<HTMLElement>('.nav-item')?.focus();
      return;
    }
    if (!wasDrawerOpenRef.current) return;
    wasDrawerOpenRef.current = false;
    if (drawerOpener?.isConnected) drawerOpener.focus();
  }, [drawerOpen, drawerOpener]);

  useEffect(() => {
    if (!drawerOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDrawer();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [drawerOpen, closeDrawer]);

  // Cmd/Ctrl+B toggles the drawer from anywhere, as it toggled the sidebar before.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isSidebarToggleShortcut(event)) return;
      event.preventDefault();
      const { open, openDrawer: show, closeDrawer: hide } = useDrawerStore.getState();
      if (open) hide();
      else show(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // A route change (any nav entry point) never leaves the drawer covering the new page.
  useEffect(() => {
    closeDrawer();
  }, [location.pathname, closeDrawer]);

  const closeLanguageMenu = useCallback(() => setLanguageMenuOpen(false), []);
  const closeThemeMenu = useCallback(() => setThemeMenuOpen(false), []);
  useMenuDismiss(languageMenuOpen, languageMenuRef, closeLanguageMenu);
  useMenuDismiss(themeMenuOpen, themeMenuRef, closeThemeMenu);

  const toggleLanguageMenu = useCallback(() => {
    setLanguageMenuOpen((prev) => !prev);
    setThemeMenuOpen(false);
  }, []);

  const toggleThemeMenu = useCallback(() => {
    setThemeMenuOpen((prev) => !prev);
    setLanguageMenuOpen(false);
  }, []);

  const handleThemeSelect = useCallback(
    (nextTheme: Theme) => {
      setTheme(nextTheme);
      setThemeMenuOpen(false);
    },
    [setTheme]
  );

  const handleLanguageSelect = useCallback(
    (nextLanguage: string) => {
      if (!isSupportedLanguage(nextLanguage)) {
        return;
      }
      setLanguage(nextLanguage);
      setLanguageMenuOpen(false);
    },
    [setLanguage]
  );

  useEffect(() => {
    fetchConfig().catch(() => {
      // Ignore the initial failure; the login flow shows the user-facing prompt.
    });
  }, [fetchConfig]);

  const loadPluginResources = useCallback(async () => {
    if (connectionStatus !== 'connected' || !supportsPlugin) {
      setPluginResources([]);
      return;
    }

    try {
      const plugins = await pluginsApi.list();
      setPluginResources(collectPluginResourceEntries(plugins.plugins));
    } catch {
      setPluginResources([]);
    }
  }, [connectionStatus, supportsPlugin]);

  const loadAuthFilesCount = useCallback(async () => {
    const requestID = ++authFilesCountRequestRef.current;
    if (connectionStatus !== 'connected') {
      setAuthFilesCount(null);
      return;
    }

    try {
      const response = await authFilesApi.list();
      if (requestID !== authFilesCountRequestRef.current) return;
      setAuthFilesCount(Array.isArray(response?.files) ? response.files.length : null);
    } catch {
      if (requestID !== authFilesCountRequestRef.current) return;
      setAuthFilesCount(null);
    }
  }, [connectionStatus]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPluginResources();
      void loadAuthFilesCount();
    }, 0);

    window.addEventListener(PLUGIN_RESOURCES_REFRESH_EVENT, loadPluginResources);
    window.addEventListener(AUTH_FILES_CHANGED_EVENT, loadAuthFilesCount);

    return () => {
      authFilesCountRequestRef.current += 1;
      window.clearTimeout(timer);
      window.removeEventListener(PLUGIN_RESOURCES_REFRESH_EVENT, loadPluginResources);
      window.removeEventListener(AUTH_FILES_CHANGED_EVENT, loadAuthFilesCount);
    };
  }, [apiBase, loadPluginResources, loadAuthFilesCount]);

  const pluginResourceGroups = pluginResources.reduce<
    Array<{ pluginID: string; pluginTitle: string; entries: PluginResourceEntry[] }>
  >((groups, resource) => {
    const group = groups.find((item) => item.pluginID === resource.pluginID);
    if (group) {
      group.entries.push(resource);
      return groups;
    }

    groups.push({
      pluginID: resource.pluginID,
      pluginTitle: resource.pluginTitle,
      entries: [resource],
    });
    return groups;
  }, []);

  const pluginPageNavItems: SidebarNavItem[] = supportsPlugin
    ? pluginResourceGroups.flatMap((group): SidebarNavItem[] => {
        if (group.entries.length === 1) {
          const resource = group.entries[0];
          const pluginLogo = resolvePluginAssetURL(resource.pluginLogo, apiBase);
          return [
            {
              path: resource.route,
              label: resource.label,
              icon: <PluginSidebarIcon src={pluginLogo} />,
            },
          ];
        }

        const pluginLogo = resolvePluginAssetURL(group.entries[0]?.pluginLogo ?? '', apiBase);
        return [
          {
            kind: 'drawer',
            id: `plugin-pages-${group.pluginID}`,
            label: group.pluginTitle,
            icon: <PluginSidebarIcon src={pluginLogo} />,
            children: group.entries.map((resource) => ({
              path: resource.route,
              label: resource.label,
              icon: <span className="nav-sub-dot" aria-hidden="true" />,
            })),
          },
        ];
      })
    : [];

  const isApiKeyFunConfigured = hasApiKeyFunConfig(config);
  const quickStartNavItem: SidebarNavLinkItem = {
    path: '/quick-start',
    label: isApiKeyFunConfigured ? APIKEY_FUN_DISPLAY_NAME : undefined,
    labelKey: isApiKeyFunConfigured ? undefined : 'nav.quick_start',
    icon: sidebarIcons.quickStart,
  };

  const navGroups: SidebarNavGroup[] = [
    {
      id: 'operate',
      labelKey: 'nav_groups.operate',
      items: [
        {
          path: '/',
          labelKey: 'nav.account_pools',
          icon: sidebarIcons.pools,
        },
        {
          path: '/dashboard',
          labelKey: 'nav.dashboard',
          icon: sidebarIcons.dashboard,
        },
        ...(!isApiKeyFunConfigured ? [quickStartNavItem] : []),
      ],
    },
    {
      id: 'gateway',
      labelKey: 'nav_groups.gateway',
      items: [
        {
          path: '/ai-providers',
          labelKey: 'nav.ai_providers',
          icon: sidebarIcons.aiProviders,
        },
        {
          path: '/auth-files',
          labelKey: 'nav.auth_files',
          badge: authFilesCount ?? undefined,
          badgeLabel:
            typeof authFilesCount === 'number'
              ? t('sidebar.auth_files_count', { count: authFilesCount })
              : undefined,
          icon: sidebarIcons.authFiles,
        },
        {
          path: '/oauth',
          labelKey: 'nav.oauth',
          icon: sidebarIcons.oauth,
        },
        ...(isApiKeyFunConfigured ? [quickStartNavItem] : []),
      ],
    },
    {
      id: 'observe',
      labelKey: 'nav_groups.observe',
      items: [
        {
          path: '/quota',
          labelKey: 'nav.quota_management',
          icon: sidebarIcons.quota,
        },
        {
          path: '/logs',
          labelKey: 'nav.logs',
          icon: sidebarIcons.logs,
        },
      ],
    },
    {
      id: 'control',
      labelKey: 'nav_groups.control',
      items: [
        {
          path: '/config',
          labelKey: 'nav.config_management',
          icon: sidebarIcons.config,
        },
        ...(supportsPlugin
          ? [
              {
                path: '/plugins',
                labelKey: 'nav.plugins',
                icon: sidebarIcons.plugins,
              },
              {
                path: '/plugin-store',
                labelKey: 'nav.plugin_store',
                icon: sidebarIcons.pluginStore,
              },
            ]
          : []),
        {
          path: '/system',
          labelKey: 'nav.system_info',
          icon: sidebarIcons.system,
        },
      ],
    },
    ...(pluginPageNavItems.length > 0
      ? [
          {
            id: 'plugin-pages',
            labelKey: 'nav_groups.plugin_pages',
            items: pluginPageNavItems,
          },
        ]
      : []),
  ];
  const navItems = navGroups.flatMap((group) => flattenNavItems(group.items));
  const navOrder = navItems.map((item) => item.path);
  const getRouteOrder = (pathname: string) => {
    const normalizedPath =
      pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

    const authFilesIndex = navOrder.indexOf('/auth-files');
    if (authFilesIndex !== -1) {
      if (normalizedPath === '/auth-files') return authFilesIndex;
      if (normalizedPath.startsWith('/auth-files/')) {
        if (normalizedPath.startsWith('/auth-files/oauth-excluded')) return authFilesIndex + 0.1;
        if (normalizedPath.startsWith('/auth-files/oauth-model-alias')) return authFilesIndex + 0.2;
        return authFilesIndex + 0.05;
      }
    }

    const exactIndex = navOrder.indexOf(normalizedPath);
    if (exactIndex !== -1) return exactIndex;
    const nestedIndex = navOrder.findIndex(
      (path) => path !== '/' && normalizedPath.startsWith(`${path}/`)
    );
    return nestedIndex === -1 ? null : nestedIndex;
  };

  const getTransitionVariant = useCallback((fromPathname: string, toPathname: string) => {
    const normalize = (pathname: string) =>
      pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

    const from = normalize(fromPathname);
    const to = normalize(toPathname);
    const isAuthFiles = (pathname: string) =>
      pathname === '/auth-files' || pathname.startsWith('/auth-files/');
    if (isAuthFiles(from) && isAuthFiles(to)) return 'ios';
    return 'vertical';
  }, []);

  const handleRefreshAll = async () => {
    clearCache();
    const results = await Promise.allSettled([
      fetchConfig(true),
      loadPluginResources(),
      loadAuthFilesCount(),
      triggerHeaderRefresh(),
    ]);
    const rejected = results.find((result) => result.status === 'rejected');
    if (rejected && rejected.status === 'rejected') {
      const reason = rejected.reason;
      const message =
        typeof reason === 'string' ? reason : reason instanceof Error ? reason.message : '';
      showNotification(
        `${t('notification.refresh_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
      return;
    }
    showNotification(t('notification.data_refreshed'), 'success');
  };

  const togglePluginResourceDrawer = useCallback((drawerID: string) => {
    setExpandedPluginResourceIDs((current) => {
      const next = new Set(current);
      if (next.has(drawerID)) {
        next.delete(drawerID);
      } else {
        next.add(drawerID);
      }
      return next;
    });
  }, []);

  const renderNavBadge = (badge?: number, badgeLabel?: string) =>
    typeof badge === 'number' ? (
      <>
        {badge > 0 ? (
          <span className="nav-badge" aria-hidden="true">
            {badge}
          </span>
        ) : null}
        {badgeLabel ? <span className="nav-badge-sr-only">{badgeLabel}</span> : null}
      </>
    ) : null;

  const renderNavLink = (item: SidebarNavLinkItem, className = 'nav-item') => {
    const itemLabel = item.label ?? (item.labelKey ? t(item.labelKey) : '');

    return (
      <NavLink
        key={item.path}
        to={item.path}
        end={item.path === '/'}
        className={({ isActive }) => `${className} ${isActive ? 'active' : ''}`}
        onClick={closeDrawer}
      >
        <span className="nav-icon">{item.icon}</span>
        <span className="nav-text">
          <span className="nav-label">{itemLabel}</span>
        </span>
        {renderNavBadge(item.badge, item.badgeLabel)}
      </NavLink>
    );
  };

  const renderNavItem = (item: SidebarNavItem) => {
    if (item.kind !== 'drawer') {
      return renderNavLink(item);
    }

    const isActive = item.children.some((child) => child.path === location.pathname);
    const isOpen = isActive || expandedPluginResourceIDs.has(item.id);

    return (
      <div className={`nav-drawer ${isOpen ? 'open' : ''}`} key={item.id}>
        <button
          type="button"
          className={`nav-item nav-drawer-toggle ${isActive ? 'active' : ''} ${
            isOpen ? 'open' : ''
          }`}
          onClick={() => togglePluginResourceDrawer(item.id)}
          aria-expanded={isOpen}
        >
          <span className="nav-icon">{item.icon}</span>
          <span className="nav-text">
            <span className="nav-label">{item.label}</span>
          </span>
          <span className="nav-drawer-caret" aria-hidden="true">
            <IconChevronDown size={14} />
          </span>
        </button>
        {isOpen ? (
          <div className="nav-sub-list">
            {item.children.map((child) => renderNavLink(child, 'nav-item nav-sub-item'))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div
      className={`app-shell ${isPluginResourcePage ? 'plugin-resource-shell' : ''} ${
        isPoolsPage ? 'pools-shell' : ''
      }`}
    >
      <div className="top-gradient-blur" aria-hidden="true" />

      <header className="main-header" ref={headerRef} inert={drawerOpen}>
        <div className="drawer-opener">
          <Button
            className="drawer-opener-btn"
            variant="ghost"
            size="sm"
            onClick={(event) => openDrawer(event.currentTarget)}
            title={t('sidebar.open_menu')}
            aria-label={t('sidebar.open_menu')}
            aria-expanded={drawerOpen}
            aria-controls={DRAWER_ID}
            aria-keyshortcuts="Meta+B Control+B"
          >
            {headerIcons.menu}
          </Button>
        </div>

        <div className="header-actions floating-actions">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefreshAll}
            title={t('header.refresh_all')}
          >
            {headerIcons.refresh}
          </Button>
          <div className={`language-menu ${languageMenuOpen ? 'open' : ''}`} ref={languageMenuRef}>
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleLanguageMenu}
              title={t('language.switch')}
              aria-label={t('language.switch')}
              aria-haspopup="menu"
              aria-expanded={languageMenuOpen}
            >
              {headerIcons.language}
            </Button>
            {languageMenuOpen && (
              <div
                className="notification entering language-menu-popover"
                role="menu"
                aria-label={t('language.switch')}
              >
                {LANGUAGE_ORDER.map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    className={`language-menu-option ${language === lang ? 'active' : ''}`}
                    onClick={() => handleLanguageSelect(lang)}
                    role="menuitemradio"
                    aria-checked={language === lang}
                  >
                    <span>{t(LANGUAGE_LABEL_KEYS[lang])}</span>
                    {language === lang ? <span className="language-menu-check">✓</span> : null}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className={`theme-menu ${themeMenuOpen ? 'open' : ''}`} ref={themeMenuRef}>
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleThemeMenu}
              title={t('theme.switch')}
              aria-label={t('theme.switch')}
              aria-haspopup="menu"
              aria-expanded={themeMenuOpen}
            >
              {theme === 'auto'
                ? headerIcons.autoTheme
                : theme === 'dark'
                  ? headerIcons.moon
                  : theme === 'white'
                    ? headerIcons.whiteTheme
                    : headerIcons.sun}
            </Button>
            {themeMenuOpen && (
              <div
                className="notification entering theme-menu-popover"
                role="menu"
                aria-label={t('theme.switch')}
              >
                {THEME_CARDS.map((tc) => (
                  <button
                    key={tc.key}
                    type="button"
                    className={`theme-card ${theme === tc.key ? 'active' : ''}`}
                    onClick={() => handleThemeSelect(tc.key)}
                    role="menuitemradio"
                    aria-checked={theme === tc.key}
                  >
                    <div
                      className="theme-card-preview"
                      style={{
                        background: tc.colors.bg,
                        border: `1px solid ${tc.colors.border}`,
                      }}
                    >
                      <div
                        className="theme-card-header"
                        style={{
                          background: tc.colors.card,
                          borderBottom: `1px solid ${tc.colors.border}`,
                        }}
                      />
                      <div className="theme-card-body">
                        <div
                          className="theme-card-sidebar"
                          style={{
                            background: tc.colors.card,
                            borderRight: `1px solid ${tc.colors.border}`,
                          }}
                        />
                        <div className="theme-card-content" style={{ background: tc.colors.bg }}>
                          <div
                            className="theme-card-line"
                            style={{ background: tc.colors.textMuted }}
                          />
                          <div
                            className="theme-card-line short"
                            style={{ background: tc.colors.textMuted }}
                          />
                        </div>
                      </div>
                    </div>
                    <span className="theme-card-label">{t(tc.labelKey)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* A trusted-network session has nothing to log out of. */}
          {keyless ? null : (
            <Button variant="ghost" size="sm" onClick={logout} title={t('header.logout')}>
              {headerIcons.logout}
            </Button>
          )}
        </div>
      </header>

      <div className="main-body">
        <div
          className={`sidebar-backdrop ${drawerOpen ? 'visible' : ''}`}
          onClick={closeDrawer}
          aria-hidden="true"
        />

        <aside
          id={DRAWER_ID}
          ref={drawerRef}
          className={`sidebar ${drawerOpen ? 'open' : ''}`}
          aria-label={t('sidebar.navigation')}
        >
          <div className="sidebar-header">
            <div className="sidebar-brand" title={fullBrandName}>
              <img src={INLINE_LOGO_JPEG} alt="CPAMC logo" className="sidebar-brand-logo" />
              <span className="sidebar-brand-text">
                <span className="sidebar-brand-title">{abbrBrandName}</span>
                <span className="sidebar-brand-subtitle">{t('sidebar.subtitle')}</span>
              </span>
            </div>
            <button
              type="button"
              className="sidebar-close"
              onClick={closeDrawer}
              aria-label={t('sidebar.close_menu')}
            >
              {headerIcons.close}
            </button>
          </div>

          <nav className="nav-section">
            {navGroups.map((group) => (
              <div className="nav-group" key={group.id}>
                <div className="nav-group-label">{t(group.labelKey)}</div>
                {group.items.map((item) => renderNavItem(item))}
              </div>
            ))}
          </nav>
        </aside>

        <div
          className={`content${isLogsPage ? ' content-logs' : ''}${
            isPluginResourcePage ? ' content-plugin-resource' : ''
          }`}
          ref={contentRef}
          inert={drawerOpen}
        >
          <main
            className={`main-content${isLogsPage ? ' main-content-logs' : ''}${
              isPluginResourcePage ? ' main-content-plugin-resource' : ''
            }${isPoolsPage ? ' main-content-pools' : ''}`}
          >
            <PageTransition
              render={(location) => <MainRoutes location={location} />}
              getRouteOrder={getRouteOrder}
              getTransitionVariant={getTransitionVariant}
              scrollContainerRef={contentRef}
            />
          </main>
        </div>
      </div>
    </div>
  );
}
