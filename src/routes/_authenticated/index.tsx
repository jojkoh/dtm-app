import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, Calculator, ClipboardList, GripVertical, Plus, Truck, UserPlus, Users } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useModulePermissions, type ModuleName } from "@/hooks/use-module-permissions";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export const Route = createFileRoute("/_authenticated/")({ component: Dashboard });

type ModuleDef = {
  key: string;
  moduleName: ModuleName;
  title: string;
  desc: string;
  icon: typeof Calculator;
  to: string;
  accent: string;
};

const modules: ModuleDef[] = [
  {
    key: "quantify",
    moduleName: "quantify_ai",
    title: "Quantify AI",
    desc: "MEP quantity takeoff & BOQ. AI extracts visible elements from drawings, rules derive engineering quantities.",
    icon: Calculator,
    to: "/quantify",
    accent: "from-blue-500/20 to-cyan-500/10",
  },
  {
    key: "dwm",
    moduleName: "daily_work_matters",
    title: "Daily Work Matters",
    desc: "Daily operational reports across sites and teams.",
    icon: ClipboardList,
    to: "/daily-work-matters",
    accent: "from-emerald-500/20 to-teal-500/10",
  },
  {
    key: "workforce",
    moduleName: "workforce_dispatch",
    title: "Workforce Dispatch",
    desc: "Daily manpower deployment, lorry dispatch board, driver and worker schedules.",
    icon: Truck,
    to: "/workforce",
    accent: "from-amber-500/20 to-orange-500/10",
  },
];

const ORDER_KEY = "dtm:workspace-module-order";

function loadOrder(): string[] | null {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) return parsed;
  } catch {}
  return null;
}

function Dashboard() {
  const { user, role } = useAuth();
  const { isLive } = useModulePermissions();

  const [order, setOrder] = useState<string[]>(() => modules.map((m) => m.key));
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const saved = loadOrder();
    if (saved) {
      // Merge: keep saved order for known keys, append any new modules
      const known = new Set(modules.map((m) => m.key));
      const filtered = saved.filter((k) => known.has(k));
      const missing = modules.map((m) => m.key).filter((k) => !filtered.includes(k));
      setOrder([...filtered, ...missing]);
    }
  }, []);

  const ordered = useMemo(() => {
    const byKey = new Map(modules.map((m) => [m.key, m]));
    return order.map((k) => byKey.get(k)).filter((m): m is ModuleDef => Boolean(m));
  }, [order]);

  const visibleModules = ordered.filter((m) => isLive(m.moduleName));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = order.indexOf(String(active.id));
    const newIndex = order.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(order, oldIndex, newIndex);
    setOrder(next);
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(next)); } catch {}
  };

  const activeModule = activeId ? modules.find((m) => m.key === activeId) ?? null : null;

  return (
    <div className="min-h-screen">
      <WorkspaceHeader />
      <main className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-10 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Welcome back</p>
            <h1 className="text-3xl font-semibold tracking-tight mt-1">
              {user?.email?.split("@")[0] ?? "Workspace"}
            </h1>
            <p className="text-muted-foreground mt-2 max-w-2xl">
              Choose a module to continue. Drag the handle to rearrange — your layout is saved on this device.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {role === "admin" && (
              <>
                <Button asChild variant="outline">
                  <Link to="/admin/users">
                    <Users className="size-4" /> Manage users
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/admin/invitations">
                    <UserPlus className="size-4" /> Invite users
                  </Link>
                </Button>
              </>
            )}
            <Button asChild variant="ghost">
              <Link to="/settings">Settings</Link>
            </Button>
          </div>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={visibleModules.map((m) => m.key)} strategy={rectSortingStrategy}>
            <div className="grid sm:grid-cols-2 gap-5">
              {visibleModules.map((m) => (
                <SortableModuleCard key={m.key} module={m} live={isLive(m.moduleName)} />
              ))}
              <Card className="p-6 border-dashed flex items-center justify-center text-center text-sm text-muted-foreground min-h-[180px]">
                <div>
                  <Plus className="size-5 mx-auto mb-2" />
                  More modules coming soon
                </div>
              </Card>
            </div>
          </SortableContext>
          <DragOverlay>
            {activeModule && <ModuleCardContent module={activeModule} live={isLive(activeModule.moduleName)} dragging />}
          </DragOverlay>
        </DndContext>
      </main>
    </div>
  );
}

function SortableModuleCard({ module: m, live }: { module: ModuleDef; live: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: m.key });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="relative">
      <button
        type="button"
        aria-label="Drag to reorder"
        className="absolute top-3 right-3 z-10 grid place-items-center size-7 rounded-md bg-background/80 backdrop-blur border text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <Link to={m.to} className="group block">
        <ModuleCardContent module={m} live={live} />
      </Link>
    </div>
  );
}

function ModuleCardContent({ module: m, live, dragging }: { module: ModuleDef; live: boolean; dragging?: boolean }) {
  return (
    <Card className={`relative overflow-hidden p-6 h-full transition-all hover:shadow-md hover:border-primary/40 ${dragging ? "shadow-lg ring-2 ring-primary/30" : ""}`}>
      <div className={`absolute inset-0 bg-gradient-to-br ${m.accent} opacity-50 pointer-events-none`} />
      <div className="relative">
        <div className="flex items-start justify-between">
          <div className="size-12 rounded-lg bg-background border grid place-items-center">
            <m.icon className="size-5 text-primary" />
          </div>
          <span className="text-xs rounded-full bg-background/80 backdrop-blur border px-2 py-1 mr-9">
            {live ? "Live" : "Offline"}
          </span>
        </div>
        <h3 className="text-lg font-semibold mt-5">{m.title}</h3>
        <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{m.desc}</p>
        <div className="mt-6 inline-flex items-center text-sm font-medium text-primary">
          Open module
          <ArrowRight className="size-4 ml-1 transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>
    </Card>
  );
}
