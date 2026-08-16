import { create } from 'zustand';

// Tier Range Definitions (ANY, XS, S, M, L, XL)
export const TIER_RANGES = {
  ANY: [150, 10000],
  XS:  [150, 600],
  S:   [600, 1200],
  M:   [1200, 2500],
  L:   [2500, 4000],
  XL:  [4000, 10000],
};

// Convert percentage (0 to 100) -> Area m² (150 to 10000 m²) across 5 equal 20% tier zones
export function percentToArea(p) {
  p = Math.max(0, Math.min(100, p));
  if (p <= 20) {
    return Math.round(150 + (p / 20) * (600 - 150));
  } else if (p <= 40) {
    return Math.round(600 + ((p - 20) / 20) * (1200 - 600));
  } else if (p <= 60) {
    return Math.round(1200 + ((p - 40) / 20) * (2500 - 1200));
  } else if (p <= 80) {
    return Math.round(2500 + ((p - 60) / 20) * (4000 - 2500));
  } else {
    return Math.round(4000 + ((p - 80) / 20) * (10000 - 4000));
  }
}

// Convert Area m² (150 to 10000 m²) -> percentage (0 to 100) across 5 equal 20% tier zones
export function areaToPercent(a) {
  a = Math.max(150, Math.min(10000, a));
  if (a <= 600) {
    return 0 + ((a - 150) / (600 - 150)) * 20;
  } else if (a <= 1200) {
    return 20 + ((a - 600) / (1200 - 600)) * 20;
  } else if (a <= 2500) {
    return 40 + ((a - 1200) / (2500 - 1200)) * 20;
  } else if (a <= 4000) {
    return 60 + ((a - 2500) / (4000 - 2500)) * 20;
  } else {
    return 80 + ((a - 4000) / (10000 - 4000)) * 20;
  }
}

const DEFAULT_FILTERS = {
  city: 'ALL', // "ALL" CITIES preselected by default
  activeTier: 'ANY', // "ANY" Tier preselected by default
  minArea: 150,
  maxArea: 10000,
  minHeight: 10,
  maxHeight: 300,
};

// Helper: Pure client-side site filtering
export function filterSitesList(allSites, filters) {
  if (!Array.isArray(allSites)) return [];
  return allSites.filter((site) => {
    // City Filter
    if (filters.city !== 'ALL') {
      const cityMatches = site.city_code === filters.city;
      if (!cityMatches) return false;
    }

    // Area Filter
    const area = site.site_area_m2 || 0;
    if (filters.activeTier === 'XL') {
      if (area < 4000) return false;
    } else if (filters.activeTier && filters.activeTier !== 'ANY') {
      const range = TIER_RANGES[filters.activeTier];
      if (range && (area < range[0] || area > range[1])) return false;
    } else {
      if (filters.minArea !== undefined && area < filters.minArea) return false;
      if (filters.maxArea !== undefined && filters.maxArea < 10000 && area > filters.maxArea) return false;
    }

    // Height Filter
    const avgH = site.avg_height_m || 0;
    if (filters.minHeight !== undefined && avgH < filters.minHeight) return false;
    if (filters.maxHeight !== undefined && avgH > filters.maxHeight) return false;

    return true;
  });
}

export const useStore = create((set, get) => ({
  allSites: [],
  filteredSites: [],
  activeSiteIndex: 0,
  viewMode: 'axonometric', // 'axonometric' | 'perspective'
  filters: { ...DEFAULT_FILTERS },

  customModalOpen: false,
  setCustomModalOpen: (open) => set({ customModalOpen: open }),

  // Set initial loaded dataset (Atomic)
  setDataset: (sites) => {
    set((state) => {
      const filtered = filterSitesList(sites, state.filters);
      return {
        allSites: sites,
        filteredSites: filtered,
        activeSiteIndex: Math.min(state.activeSiteIndex, Math.max(0, filtered.length - 1)),
      };
    });
  },

  // Add newly harvested custom site to state and immediately activate it (Atomic)
  addCustomSite: (customSite) => {
    const siteObj = {
      ...customSite,
      render_html: customSite.render_html || `sites/${customSite.site_id}.html`,
    };

    set((state) => {
      const exists = state.allSites.some((s) => s.site_id === customSite.site_id);
      const newAllSites = exists
        ? state.allSites.map((s) => (s.site_id === customSite.site_id ? siteObj : s))
        : [siteObj, ...state.allSites];

      const newFilters = { ...DEFAULT_FILTERS }; // Reset filters so custom site is immediately displayed
      const newFiltered = filterSitesList(newAllSites, newFilters);
      const targetIdx = newFiltered.findIndex((s) => s.site_id === customSite.site_id);

      return {
        allSites: newAllSites,
        filters: newFilters,
        filteredSites: newFiltered,
        activeSiteIndex: targetIdx !== -1 ? targetIdx : 0,
      };
    });
  },

  // Delete custom site from state and persistently remove from backend JSON dataset (Atomic)
  deleteCustomSite: async (siteId) => {
    set((state) => {
      const newAllSites = state.allSites.filter((s) => s.site_id !== siteId);
      const newFiltered = filterSitesList(newAllSites, state.filters);
      return {
        allSites: newAllSites,
        filteredSites: newFiltered,
        activeSiteIndex: Math.min(state.activeSiteIndex, Math.max(0, newFiltered.length - 1)),
      };
    });

    try {
      await fetch('/api/delete-custom-site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_id: siteId }),
      });
    } catch (err) {
      console.error('Failed to persistently delete custom site:', err);
    }
  },

  // Update specific filter property (Atomic)
  setFilter: (key, value) => {
    set((state) => {
      const updatedFilters = { ...state.filters, [key]: value };
      if (key === 'minArea' || key === 'maxArea') {
        const minA = updatedFilters.minArea;
        const maxA = updatedFilters.maxArea;
        let matchedTier = null;
        for (const [tierKey, [tMin, tMax]] of Object.entries(TIER_RANGES)) {
          if (minA === tMin && maxA === tMax) {
            matchedTier = tierKey;
            break;
          }
        }
        updatedFilters.activeTier = matchedTier;
      }

      const currentSite = state.filteredSites[state.activeSiteIndex];
      const newFiltered = filterSitesList(state.allSites, updatedFilters);

      let newIndex = 0;
      if (currentSite) {
        const idxInFiltered = newFiltered.findIndex((s) => s.site_id === currentSite.site_id);
        if (idxInFiltered !== -1) {
          newIndex = idxInFiltered;
        }
      }

      return {
        filters: updatedFilters,
        filteredSites: newFiltered,
        activeSiteIndex: newIndex,
      };
    });
  },

  // Select small Tier preset button (ANY, XS, S, M, L, XL) (Atomic)
  selectTier: (tier) => {
    const range = TIER_RANGES[tier];
    if (!range) return;

    set((state) => {
      const updatedFilters = {
        ...state.filters,
        activeTier: tier,
        minArea: range[0],
        maxArea: range[1],
      };

      const currentSite = state.filteredSites[state.activeSiteIndex];
      const newFiltered = filterSitesList(state.allSites, updatedFilters);

      let newIndex = 0;
      if (currentSite) {
        const idxInFiltered = newFiltered.findIndex((s) => s.site_id === currentSite.site_id);
        if (idxInFiltered !== -1) {
          newIndex = idxInFiltered;
        }
      }

      return {
        filters: updatedFilters,
        filteredSites: newFiltered,
        activeSiteIndex: newIndex,
      };
    });
  },

  // Reset all filters to default state (Atomic)
  resetFilters: () => {
    set((state) => {
      const updatedFilters = { ...DEFAULT_FILTERS };
      const currentSite = state.filteredSites[state.activeSiteIndex];
      const newFiltered = filterSitesList(state.allSites, updatedFilters);

      let newIndex = 0;
      if (currentSite) {
        const idxInFiltered = newFiltered.findIndex((s) => s.site_id === currentSite.site_id);
        if (idxInFiltered !== -1) {
          newIndex = idxInFiltered;
        }
      }

      return {
        filters: updatedFilters,
        filteredSites: newFiltered,
        activeSiteIndex: newIndex,
      };
    });
  },

  // Apply client-side filtering (Atomic fallback)
  applyFilters: () => {
    set((state) => {
      const currentSite = state.filteredSites[state.activeSiteIndex];
      const filtered = filterSitesList(state.allSites, state.filters);

      let newIndex = 0;
      if (currentSite) {
        const idxInFiltered = filtered.findIndex((s) => s.site_id === currentSite.site_id);
        if (idxInFiltered !== -1) {
          newIndex = idxInFiltered;
        }
      }

      return {
        filteredSites: filtered,
        activeSiteIndex: newIndex,
      };
    });
  },

  // Navigate Carousel (Next/Prev)
  navigateCarousel: (delta) => {
    const { filteredSites, activeSiteIndex } = get();
    if (filteredSites.length === 0) return;
    const nextIndex = (activeSiteIndex + delta + filteredSites.length) % filteredSites.length;
    set({ activeSiteIndex: nextIndex });
  },

  // Set Active Site Index directly
  setActiveSiteIndex: (index) => {
    const { filteredSites } = get();
    if (index >= 0 && index < filteredSites.length) {
      set({ activeSiteIndex: index });
    }
  },

  // Pick Random Site (Forced to pick a site that is NOT the current active one; does nothing if <= 1 site)
  pickRandomSite: () => {
    const { filteredSites, activeSiteIndex } = get();
    if (filteredSites.length <= 1) return;
    
    // Uniform random pick among all indices excluding activeSiteIndex
    let randomIndex = Math.floor(Math.random() * (filteredSites.length - 1));
    if (randomIndex >= activeSiteIndex) {
      randomIndex += 1;
    }
    
    set({ activeSiteIndex: randomIndex });
  },

  // Toggle Camera View Mode
  setViewMode: (mode) => set({ viewMode: mode }),
}));
