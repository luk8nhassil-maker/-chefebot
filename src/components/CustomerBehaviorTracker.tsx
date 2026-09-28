"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  behaviorAppOpenAlreadySent,
  classifyBehaviorSource,
  detectBehaviorDeviceClass,
  detectBehaviorDisplayMode,
  markBehaviorAppOpenSent,
  trackBehavior,
  trackBehaviorBeacon,
} from "@/lib/behaviorClient";
import { classifyPublicBehaviorPage } from "@/lib/behaviorEvents";

/**
 * Tracker global das rotas públicas do cliente.
 *
 * Não renderiza UI, não observa admin/salão/dev/login e não coleta conteúdo
 * livre da página. O servidor decide se a coleta está realmente habilitada.
 */
export default function CustomerBehaviorTracker() {
  const pathname = usePathname();
  const hiddenAtRef = useRef<number | null>(null);

  useEffect(() => {
    const page = classifyPublicBehaviorPage(pathname);
    if (!page) return;

    if (!behaviorAppOpenAlreadySent()) {
      trackBehavior("app_open", {
        page,
        source: classifyBehaviorSource(),
        deviceClass: detectBehaviorDeviceClass(),
        displayMode: detectBehaviorDisplayMode(),
      });
      markBehaviorAppOpenSent();
    }

    trackBehavior("page_view", {
      page,
      deviceClass: detectBehaviorDeviceClass(),
      displayMode: detectBehaviorDisplayMode(),
    });
  }, [pathname]);

  useEffect(() => {
    const page = classifyPublicBehaviorPage(pathname);
    if (!page) return;

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        if (hiddenAtRef.current === null) {
          hiddenAtRef.current = Date.now();
          trackBehaviorBeacon("app_background", { page });
        }
        return;
      }

      if (document.visibilityState === "visible" && hiddenAtRef.current !== null) {
        const hiddenDurationSec = Math.max(
          0,
          Math.round((Date.now() - hiddenAtRef.current) / 1000),
        );
        hiddenAtRef.current = null;
        trackBehavior("app_resume", { page, hiddenDurationSec });
      }
    };

    const onPageHide = () => {
      if (hiddenAtRef.current === null) {
        hiddenAtRef.current = Date.now();
        trackBehaviorBeacon("app_background", { page });
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [pathname]);

  return null;
}
