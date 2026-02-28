import "dotenv/config";
import { randomUUID } from "crypto";
import http from "http";
import express from "express";
import cors from "cors";
import session from "express-session";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { PrismaClient } from "@prisma/client";
import { Server as SocketIOServer } from "socket.io";

const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT ?? 4000);
const DEFAULT_PROJECT_SLUG = "default";
const DEFAULT_PROJECT_NAME = "Vennify Project";
const CLIENT_ORIGINS = (process.env.CORS_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const CLIENT_ORIGIN = CLIENT_ORIGINS[0] ?? "http://localhost:5173";
const SESSION_SECRET = process.env.SESSION_SECRET ?? "dev-secret";
const NODE_ENV = process.env.NODE_ENV ?? "development";
const IS_PRODUCTION = NODE_ENV === "production";
const COOKIE_SECURE =
  process.env.COOKIE_SECURE != null
    ? process.env.COOKIE_SECURE === "true"
    : IS_PRODUCTION;
const COOKIE_SAME_SITE = (process.env.COOKIE_SAME_SITE ?? "").toLowerCase();
const SAME_SITE_COOKIE: "lax" | "strict" | "none" =
  COOKIE_SAME_SITE === "strict"
    ? "strict"
    : COOKIE_SAME_SITE === "none"
      ? "none"
      : "lax";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
const GOOGLE_CALLBACK_URL =
  process.env.GOOGLE_CALLBACK_URL ??
  "http://localhost:4000/auth/google/callback";

const isAllowedOrigin = (origin?: string | null) =>
  !origin || CLIENT_ORIGINS.includes(origin);

app.set("trust proxy", 1);

app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));
const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: SAME_SITE_COOKIE,
    secure: COOKIE_SECURE,
  },
});
app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());

const io = new SocketIOServer(server, {
  cors: {
    origin: CLIENT_ORIGINS,
    credentials: true,
  },
});

io.use((socket, next) => {
  sessionMiddleware(socket.request as any, {} as any, next as any);
});

io.use((socket, next) => {
  const req = socket.request as any;
  const userId = req.session?.passport?.user;
  if (!userId) {
    next(new Error("Unauthorized"));
    return;
  }
  socket.data.userId = userId;
  next();
});

const ensureWorkspaceMembership = async (
  workspaceId: string,
  userId: string
) => {
  const membership = await prisma.workspaceMember.findFirst({
    where: { workspaceId, userId },
  });
  if (!membership) {
    throw new Error("Forbidden");
  }
  return membership;
};

io.on("connection", (socket) => {
  const userRoom = `user:${socket.data.userId}`;
  socket.join(userRoom);

  socket.on("joinProject", async (payload: { workspaceId: string; slug: string }) => {
    try {
      const workspaceId = payload?.workspaceId;
      const slug = payload?.slug ?? DEFAULT_PROJECT_SLUG;
      if (!workspaceId) return;
      await ensureWorkspaceMembership(workspaceId, socket.data.userId as string);
      const project = await ensureProject(workspaceId, slug);
      if (socket.data.room) {
        socket.leave(socket.data.room);
      }
      const room = `project:${project.id}`;
      socket.join(room);
      socket.data.room = room;
      socket.data.workspaceId = workspaceId;
      socket.data.projectId = project.id;
      socket.emit("joinedProject", { projectId: project.id });
    } catch {
      socket.emit("joinError");
    }
  });

  socket.on(
    "canvas:update",
    (payload: {
      workspaceId: string;
      slug: string;
      modules: any[];
      items: any[];
      clientId?: string;
    }) => {
      const room = socket.data.room as string | undefined;
      if (!room) return;
      if (!payload?.workspaceId || payload.workspaceId !== socket.data.workspaceId) {
        return;
      }
      socket.to(room).emit("canvas:update", {
        modules: payload.modules,
        items: payload.items,
        clientId: payload.clientId ?? null,
        workspaceId: payload.workspaceId,
        slug: payload.slug,
      });
    }
  );

  socket.on(
    "item:update",
    (payload: {
      workspaceId: string;
      slug: string;
      item: any;
      clientId?: string;
    }) => {
      const room = socket.data.room as string | undefined;
      if (!room) return;
      if (!payload?.workspaceId || payload.workspaceId !== socket.data.workspaceId) {
        return;
      }
      socket.to(room).emit("item:update", {
        item: payload.item,
        workspaceId: payload.workspaceId,
        slug: payload.slug,
        clientId: payload.clientId ?? null,
      });
    }
  );

  socket.on(
    "item:delete",
    (payload: { workspaceId: string; slug: string; itemId: string; clientId?: string }) => {
      const room = socket.data.room as string | undefined;
      if (!room) return;
      if (!payload?.workspaceId || payload.workspaceId !== socket.data.workspaceId) {
        return;
      }
      socket.to(room).emit("item:delete", {
        itemId: payload.itemId,
        workspaceId: payload.workspaceId,
        slug: payload.slug,
        clientId: payload.clientId ?? null,
      });
    }
  );
});

passport.serializeUser((user, done) => {
  done(null, (user as { id: string }).id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await prisma.user.findUnique({ where: { id } });
    done(null, user ?? null);
  } catch (error) {
    done(error, null);
  }
});

passport.use(
  new GoogleStrategy(
    {
      clientID: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      callbackURL: GOOGLE_CALLBACK_URL,
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value ?? "";
        const avatarUrl = profile.photos?.[0]?.value ?? null;
        if (!email) {
          done(new Error("Google account has no email."), undefined);
          return;
        }

        const user = await prisma.user.upsert({
          where: { providerId: profile.id },
          update: { name: profile.displayName, email, avatarUrl },
          create: {
            email,
            name: profile.displayName,
            avatarUrl,
            provider: "google",
            providerId: profile.id,
          },
        });
        done(null, user);
      } catch (error) {
        done(error as Error, undefined);
      }
    }
  )
);

const requireAuth: express.RequestHandler = (req, res, next) => {
  if (req.isAuthenticated?.() && req.user) {
    next();
    return;
  }
  res.status(401).json({ error: "Unauthorized" });
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");

const ensureProject = async (workspaceId: string, slug: string) => {
  const existing = await prisma.project.findUnique({
    where: { workspaceId_slug: { workspaceId, slug } },
  });
  if (existing) return existing;

  return prisma.project.create({
    data: {
      slug,
      name: DEFAULT_PROJECT_NAME,
      workspaceId,
    },
  });
};

const ensureWorkspaceOwner = async (userId: string, email: string) => {
  const membership = await prisma.workspaceMember.findFirst({
    where: { userId },
  });
  if (membership) return null;

  const legacyWorkspace = await prisma.workspace.findUnique({
    where: { slug: "default" },
    include: { members: true },
  });
  if (legacyWorkspace && legacyWorkspace.members.length === 0) {
    await prisma.workspaceMember.create({
      data: { workspaceId: legacyWorkspace.id, userId, role: "OWNER" },
    });
    return legacyWorkspace;
  }

  const base = slugify(email.split("@")[0] ?? "workspace");
  const slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  const workspace = await prisma.workspace.create({
    data: { slug, name: "My Workspace" },
  });
  await prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId, role: "OWNER" },
  });
  return workspace;
};

const requireWorkspaceAccess = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  const user = req.user as { id: string };
  const workspaceId = req.params.workspaceId;
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: user.id } },
  });
  if (!membership) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  (req as express.Request & { membership: typeof membership }).membership =
    membership;
  next();
};

const normalizeDate = (value: unknown) => {
  if (!value) return null;
  try {
    return new Date(value as string).toISOString();
  } catch {
    return null;
  }
};

const arraysEqual = (a: unknown[], b: unknown[]) =>
  JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

const buildItemChanges = (before: any, after: any) => {
  const changes: { field: string; from: unknown; to: unknown }[] = [];
  const addChange = (field: string, from: unknown, to: unknown) => {
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      changes.push({ field, from, to });
    }
  };

  addChange("title", before.title, after.title);
  addChange("description", before.description, after.description);
  addChange("status", before.status, after.status);
  addChange("priority", before.priority, after.priority);
  addChange("icon", before.icon ?? null, after.icon ?? null);
  addChange("color", before.color ?? null, after.color ?? null);
  addChange(
    "startDate",
    normalizeDate(before.startDate),
    normalizeDate(after.startDate)
  );
  addChange(
    "dueDate",
    normalizeDate(before.dueDate),
    normalizeDate(after.dueDate)
  );
  if (!arraysEqual(before.assigneeIds ?? [], after.assigneeIds ?? [])) {
    changes.push({
      field: "assigneeIds",
      from: before.assigneeIds ?? [],
      to: after.assigneeIds ?? [],
    });
  }
  if (!arraysEqual(before.relatedItemIds ?? [], after.relatedItemIds ?? [])) {
    changes.push({
      field: "relatedItemIds",
      from: before.relatedItemIds ?? [],
      to: after.relatedItemIds ?? [],
    });
  }
  if (!arraysEqual(before.customFields ?? [], after.customFields ?? [])) {
    changes.push({
      field: "customFields",
      from: before.customFields ?? [],
      to: after.customFields ?? [],
    });
  }

  return changes;
};

const emitNotification = (notification: {
  id: string;
  userId: string;
  workspaceId: string;
  itemId?: string | null;
  type: string;
  message: string;
  meta?: any;
  read: boolean;
  createdAt: Date;
}) => {
  io.to(`user:${notification.userId}`).emit("notification:new", {
    id: notification.id,
    userId: notification.userId,
    workspaceId: notification.workspaceId,
    itemId: notification.itemId ?? null,
    type: notification.type,
    message: notification.message,
    meta: notification.meta ?? null,
    read: notification.read,
    createdAt: notification.createdAt,
  });
};

const buildItemPayload = async (
  item: any,
  positionOverride?: { x: number; y: number; zIndex: number } | null
) => {
  const position =
    positionOverride ??
    (await prisma.itemPosition.findUnique({ where: { itemId: item.id } }));
  return {
    ...item,
    customFields: item.customFields ?? [],
    relatedItemIds: item.relatedItemIds ?? [],
    position: position
      ? { x: position.x, y: position.y, zIndex: position.zIndex }
      : { x: 0, y: 0, zIndex: 1 },
  };
};

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get(
  "/api/workspaces/:workspaceId/preferences/list-view",
  requireAuth,
  requireWorkspaceAccess,
  async (req, res) => {
    try {
      const userId = (req.user as { id: string }).id;
      const preference = await prisma.listViewPreference.findUnique({
        where: { userId_workspaceId: { userId, workspaceId: req.params.workspaceId } },
      });
      res.json({ columns: preference?.columns ?? null });
    } catch {
      res.status(500).json({ error: "Failed to load list preferences." });
    }
  }
);

app.patch(
  "/api/workspaces/:workspaceId/preferences/list-view",
  requireAuth,
  requireWorkspaceAccess,
  async (req, res) => {
    const columns = req.body?.columns;
    if (!Array.isArray(columns)) {
      res.status(400).json({ error: "Invalid columns payload." });
      return;
    }
    try {
      const userId = (req.user as { id: string }).id;
      const preference = await prisma.listViewPreference.upsert({
        where: { userId_workspaceId: { userId, workspaceId: req.params.workspaceId } },
        update: { columns },
        create: { userId, workspaceId: req.params.workspaceId, columns },
      });
      res.json({ columns: preference.columns });
    } catch {
      res.status(500).json({ error: "Failed to save list preferences." });
    }
  }
);

app.get("/api/me", (req, res) => {
  if (!req.user) {
    res.json({ user: null });
    return;
  }
  const user = req.user as {
    id: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
  };
  res.json({ user });
});

app.get(
  "/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

app.get(
  "/auth/google/callback",
  passport.authenticate("google", { failureRedirect: CLIENT_ORIGIN }),
  (_req, res) => {
    res.redirect(CLIENT_ORIGIN);
  }
);

app.post("/auth/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      res.status(500).json({ error: "Logout failed." });
      return;
    }
    res.json({ ok: true });
  });
});

app.get("/api/workspaces", requireAuth, async (req, res) => {
  const user = req.user as { id: string; email: string };
  await ensureWorkspaceOwner(user.id, user.email);

  const memberships = await prisma.workspaceMember.findMany({
    where: { userId: user.id },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  });

  res.json({
    workspaces: memberships.map((membership) => ({
      id: membership.workspace.id,
      slug: membership.workspace.slug,
      name: membership.workspace.name,
      role: membership.role,
    })),
  });
});

app.get("/api/invites", requireAuth, async (req, res) => {
  const user = req.user as { id: string; email: string };
  const invites = await prisma.workspaceInvite.findMany({
    where: { email: user.email, status: "PENDING" },
    include: { workspace: true },
    orderBy: { createdAt: "desc" },
  });

  res.json({
    invites: invites.map((invite) => ({
      id: invite.id,
      email: invite.email,
      role: invite.role,
      token: invite.token,
      workspace: {
        id: invite.workspace.id,
        name: invite.workspace.name,
      },
      createdAt: invite.createdAt,
    })),
  });
});

app.post("/api/workspaces", requireAuth, async (req, res) => {
  const user = req.user as { id: string; email: string };
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "Workspace name is required." });
    return;
  }
  const base = slugify(name);
  const slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  const workspace = await prisma.workspace.create({
    data: { slug, name },
  });
  await prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: user.id, role: "OWNER" },
  });
  res.json({
    workspace: {
      id: workspace.id,
      slug: workspace.slug,
      name: workspace.name,
      role: "OWNER",
    },
  });
});

app.patch(
  "/api/workspaces/:workspaceId",
  requireAuth,
  requireWorkspaceAccess,
  async (req, res) => {
    const membership = (req as express.Request & { membership: { role: string } })
      .membership;
    if (!["OWNER", "ADMIN"].includes(membership.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name) {
      res.status(400).json({ error: "Workspace name is required." });
      return;
    }
    const workspace = await prisma.workspace.update({
      where: { id: req.params.workspaceId },
      data: { name },
    });
    res.json({
      workspace: {
        id: workspace.id,
        slug: workspace.slug,
        name: workspace.name,
        role: membership.role,
      },
    });
  }
);

app.post(
  "/api/workspaces/:workspaceId/invite",
  requireAuth,
  requireWorkspaceAccess,
  async (req, res) => {
    const membership = (req as express.Request & { membership: { role: string } })
      .membership;
    if (!["OWNER", "ADMIN"].includes(membership.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const email =
      typeof req.body?.email === "string" ? req.body.email.trim() : "";
    const role =
      typeof req.body?.role === "string" ? req.body.role.trim() : "MEMBER";
    if (!email) {
      res.status(400).json({ error: "Invite email is required." });
      return;
    }

    const token = randomUUID();
    const invite = await prisma.workspaceInvite.create({
      data: {
        workspaceId: req.params.workspaceId,
        email,
        role,
        token,
        status: "PENDING",
      },
    });

    res.json({
      invite: {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        token: invite.token,
      },
      inviteUrl: `${CLIENT_ORIGIN}/?invite=${invite.token}`,
    });
  }
);

app.get(
  "/api/workspaces/:workspaceId/members",
  requireAuth,
  requireWorkspaceAccess,
  async (req, res) => {
    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId: req.params.workspaceId },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    });
    res.json({
      members: members.map((member) => ({
        id: member.user.id,
        name: member.user.name,
        email: member.user.email,
        avatarUrl: member.user.avatarUrl,
        role: member.role,
      })),
    });
  }
);

app.post("/api/invites/accept", requireAuth, async (req, res) => {
  const user = req.user as { id: string; email: string };
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  if (!token) {
    res.status(400).json({ error: "Invite token is required." });
    return;
  }

  const invite = await prisma.workspaceInvite.findUnique({ where: { token } });
  if (!invite || invite.status !== "PENDING") {
    res.status(404).json({ error: "Invite not found." });
    return;
  }
  if (invite.email !== user.email) {
    res.status(403).json({ error: "Invite is for another user." });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.workspaceMember.upsert({
      where: {
        workspaceId_userId: { workspaceId: invite.workspaceId, userId: user.id },
      },
      update: { role: invite.role },
      create: {
        workspaceId: invite.workspaceId,
        userId: user.id,
        role: invite.role,
      },
    });
    await tx.workspaceInvite.update({
      where: { id: invite.id },
      data: { status: "ACCEPTED" },
    });
  });

  res.json({ ok: true });
});

app.get(
  "/api/workspaces/:workspaceId/projects/:slug/state",
  requireAuth,
  requireWorkspaceAccess,
  async (req, res) => {
  try {
    const project = await ensureProject(req.params.workspaceId, req.params.slug);
    const modules = await prisma.module.findMany({
      where: { projectId: project.id },
    });
    const items = await prisma.item.findMany({
      where: { projectId: project.id },
      include: { position: true },
    });

    res.json({
      project: { id: project.id, slug: project.slug, name: project.name },
      modules,
      items: items.map((item) => ({
        ...item,
        customFields: item.customFields ?? [],
        relatedItemIds: item.relatedItemIds ?? [],
        position: item.position
          ? {
              x: item.position.x,
              y: item.position.y,
              zIndex: item.position.zIndex,
            }
          : { x: 0, y: 0, zIndex: 1 },
      })),
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to load project state." });
  }
  }
);

app.put(
  "/api/workspaces/:workspaceId/projects/:slug/state",
  requireAuth,
  requireWorkspaceAccess,
  async (req, res) => {
  const { modules, items, projectName } = req.body ?? {};
  if (!Array.isArray(modules) || !Array.isArray(items)) {
    res.status(400).json({ error: "Invalid payload." });
    return;
  }

  try {
    const project = await ensureProject(req.params.workspaceId, req.params.slug);
    if (projectName && typeof projectName === "string") {
      await prisma.project.update({
        where: { id: project.id },
        data: { name: projectName },
      });
    }

    const moduleIds = modules.map((module) => module.id);
    const itemIds = items.map((item) => item.id);

    await prisma.$transaction(async (tx) => {
      await tx.module.deleteMany({
        where: {
          projectId: project.id,
          id: { notIn: moduleIds.length ? moduleIds : ["__none__"] },
        },
      });

      for (const module of modules) {
        await tx.module.upsert({
          where: { id: module.id },
          update: {
            name: module.name,
            description: module.description ?? "",
            color: module.color,
            shape: module.shape ?? "solid",
            milestones: module.milestones ?? [],
            x: module.x,
            y: module.y,
            radius: module.radius,
            zIndex: module.zIndex,
            locked: module.locked,
          },
          create: {
            id: module.id,
            projectId: project.id,
            name: module.name,
            description: module.description ?? "",
            color: module.color,
            shape: module.shape ?? "solid",
            milestones: module.milestones ?? [],
            x: module.x,
            y: module.y,
            radius: module.radius,
            zIndex: module.zIndex,
            locked: module.locked,
          },
        });
      }

      await tx.item.deleteMany({
        where: {
          projectId: project.id,
          id: { notIn: itemIds.length ? itemIds : ["__none__"] },
        },
      });

      for (const item of items) {
        await tx.item.upsert({
          where: { id: item.id },
          update: {
            title: item.title,
            description: item.description,
            status: item.status,
            priority: item.priority,
            icon: item.icon ?? null,
            color: item.color ?? null,
            ownerModuleId: item.ownerModuleId ?? null,
            startDate: item.startDate ? new Date(item.startDate) : null,
            dueDate: item.dueDate ? new Date(item.dueDate) : null,
            tags: item.tags ?? [],
            assigneeIds: item.assigneeIds ?? [],
            customFields: item.customFields ?? [],
            relatedItemIds: item.relatedItemIds ?? [],
            createdBy: item.createdBy ?? "unknown",
          },
          create: {
            id: item.id,
            projectId: project.id,
            title: item.title,
            description: item.description,
            status: item.status,
            priority: item.priority,
            icon: item.icon ?? null,
            color: item.color ?? null,
            ownerModuleId: item.ownerModuleId ?? null,
            startDate: item.startDate ? new Date(item.startDate) : null,
            dueDate: item.dueDate ? new Date(item.dueDate) : null,
            tags: item.tags ?? [],
            assigneeIds: item.assigneeIds ?? [],
            customFields: item.customFields ?? [],
            relatedItemIds: item.relatedItemIds ?? [],
            createdBy: item.createdBy ?? "unknown",
          },
        });

        if (item.position) {
          await tx.itemPosition.upsert({
            where: { itemId: item.id },
            update: {
              x: item.position.x,
              y: item.position.y,
              zIndex: item.position.zIndex,
            },
            create: {
              itemId: item.id,
              x: item.position.x,
              y: item.position.y,
              zIndex: item.position.zIndex,
            },
          });
        }
  }
});

app.get("/api/notifications", requireAuth, async (req, res) => {
  try {
    const userId = (req.user as { id: string }).id;
    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json({ notifications });
  } catch {
    res.status(500).json({ error: "Failed to load notifications." });
  }
});

app.patch("/api/notifications/mark-read", requireAuth, async (req, res) => {
  try {
    const userId = (req.user as { id: string }).id;
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
    if (ids && ids.length > 0) {
      await prisma.notification.updateMany({
        where: { userId, id: { in: ids } },
        data: { read: true },
      });
    } else {
      await prisma.notification.updateMany({
        where: { userId, read: false },
        data: { read: true },
      });
    }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to update notifications." });
  }
});

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to save project state." });
  }
  }
);

app.post(
  "/api/workspaces/:workspaceId/projects/:slug/items",
  requireAuth,
  requireWorkspaceAccess,
  async (req, res) => {
    const { item, position } = req.body ?? {};
    if (!item || typeof item.title !== "string") {
      res.status(400).json({ error: "Invalid item payload." });
      return;
    }
    try {
      const project = await ensureProject(req.params.workspaceId, req.params.slug);
      const created = await prisma.item.create({
        data: {
          id: item.id ?? randomUUID(),
          projectId: project.id,
          title: item.title,
          description: item.description ?? "",
          status: item.status ?? "BACKLOG",
          priority: item.priority ?? "MEDIUM",
          icon: item.icon ?? null,
          color: item.color ?? null,
          ownerModuleId: item.ownerModuleId ?? null,
          startDate: item.startDate ? new Date(item.startDate) : null,
          dueDate: item.dueDate ? new Date(item.dueDate) : null,
          tags: item.tags ?? [],
          assigneeIds: item.assigneeIds ?? [],
          customFields: item.customFields ?? [],
          relatedItemIds: item.relatedItemIds ?? [],
          createdBy: item.createdBy ?? "unknown",
        },
      });

      if (position) {
        await prisma.itemPosition.create({
          data: {
            itemId: created.id,
            x: position.x ?? 0,
            y: position.y ?? 0,
            zIndex: position.zIndex ?? 1,
          },
        });
      }

      const actorId = (req.user as { id: string }).id;
      await prisma.activityLog.create({
        data: {
          projectId: project.id,
          itemId: created.id,
          actorId,
          action: "ITEM_CREATED",
          meta: { title: created.title },
        },
      });

      const assigneeTargets = (created.assigneeIds ?? []).filter(
        (id) => id && id !== actorId
      );
      for (const userId of assigneeTargets) {
        const notification = await prisma.notification.create({
          data: {
            userId,
            workspaceId: req.params.workspaceId,
            itemId: created.id,
            type: "ASSIGNMENT",
            message: `You were assigned to "${created.title}".`,
            meta: { itemId: created.id, title: created.title, projectId: project.id },
          },
        });
        emitNotification(notification);
      }

      const payload = await buildItemPayload(created, position ?? null);
      io.to(`project:${project.id}`).emit("item:update", {
        item: payload,
        workspaceId: req.params.workspaceId,
        slug: req.params.slug,
      });

      res.json({ item: payload });
    } catch {
      res.status(500).json({ error: "Failed to create item." });
    }
  }
);

app.patch(
  "/api/workspaces/:workspaceId/projects/:slug/items/:itemId",
  requireAuth,
  requireWorkspaceAccess,
  async (req, res) => {
    const { item, position } = req.body ?? {};
    if (!item) {
      res.status(400).json({ error: "Invalid item payload." });
      return;
    }
    try {
      const project = await ensureProject(req.params.workspaceId, req.params.slug);
      const existing = await prisma.item.findFirst({
        where: { id: req.params.itemId, projectId: project.id },
      });
      if (!existing) {
        res.status(404).json({ error: "Item not found." });
        return;
      }
      const nextState = {
        title: item.title ?? existing.title,
        description: item.description ?? existing.description,
        status: item.status ?? existing.status,
        priority: item.priority ?? existing.priority,
        icon: item.icon ?? existing.icon ?? null,
        color: item.color ?? existing.color ?? null,
        ownerModuleId: item.ownerModuleId ?? existing.ownerModuleId ?? null,
        startDate: item.startDate ?? existing.startDate,
        dueDate: item.dueDate ?? existing.dueDate,
        tags: item.tags ?? existing.tags,
        assigneeIds: item.assigneeIds ?? existing.assigneeIds,
        customFields: item.customFields ?? existing.customFields ?? [],
        relatedItemIds: item.relatedItemIds ?? existing.relatedItemIds ?? [],
      };
      const actorId = (req.user as { id: string }).id;

      const dependencyItems = nextState.relatedItemIds.length
        ? await prisma.item.findMany({
            where: {
              projectId: project.id,
              id: { in: nextState.relatedItemIds },
            },
            select: { id: true, status: true },
          })
        : [];
      const allDependenciesDone =
        nextState.relatedItemIds.length > 0 &&
        dependencyItems.length === nextState.relatedItemIds.length &&
        dependencyItems.every((dep) => dep.status === "DONE");
      const shouldUnblockSelf =
        nextState.status === "ROADBLOCKED" && allDependenciesDone;
      if (shouldUnblockSelf) {
        nextState.status = "TODO";
      }

      const changes = buildItemChanges(existing, nextState);
      const previousAssignees = existing.assigneeIds ?? [];
      const nextAssignees = nextState.assigneeIds ?? [];
      const addedAssignees = nextAssignees.filter(
        (id) => !previousAssignees.includes(id) && id !== actorId
      );
      const updated = await prisma.item.update({
        where: { id: req.params.itemId },
        data: {
          title: nextState.title,
          description: nextState.description,
          status: nextState.status,
          priority: nextState.priority,
          icon: nextState.icon ?? null,
          color: nextState.color ?? null,
          ownerModuleId: nextState.ownerModuleId ?? null,
          startDate: nextState.startDate ? new Date(nextState.startDate) : null,
          dueDate: nextState.dueDate ? new Date(nextState.dueDate) : null,
          tags: nextState.tags ?? [],
          assigneeIds: nextState.assigneeIds ?? [],
          customFields: nextState.customFields ?? [],
          relatedItemIds: nextState.relatedItemIds ?? [],
        },
      });

      if (position) {
        await prisma.itemPosition.upsert({
          where: { itemId: updated.id },
          update: {
            x: position.x,
            y: position.y,
            zIndex: position.zIndex,
          },
          create: {
            itemId: updated.id,
            x: position.x,
            y: position.y,
            zIndex: position.zIndex,
          },
        });
      }

      if (changes.length > 0) {
        await prisma.activityLog.create({
          data: {
            projectId: project.id,
            itemId: updated.id,
            actorId,
            action: "ITEM_UPDATED",
            meta: { changes },
          },
        });
      }

      if (addedAssignees.length > 0) {
        for (const userId of addedAssignees) {
          const notification = await prisma.notification.create({
            data: {
              userId,
              workspaceId: req.params.workspaceId,
              itemId: updated.id,
              type: "ASSIGNMENT",
              message: `You were assigned to "${updated.title}".`,
              meta: {
                itemId: updated.id,
                title: updated.title,
                projectId: project.id,
              },
            },
          });
          emitNotification(notification);
        }
      }

      if (shouldUnblockSelf && updated.assigneeIds.length > 0) {
        for (const userId of updated.assigneeIds) {
          if (userId === actorId) continue;
          const notification = await prisma.notification.create({
            data: {
              userId,
              workspaceId: req.params.workspaceId,
              itemId: updated.id,
              type: "UNBLOCKED",
              message: `"${updated.title}" is now unblocked.`,
              meta: { itemId: updated.id, title: updated.title, projectId: project.id },
            },
          });
          emitNotification(notification);
        }
        await prisma.activityLog.create({
          data: {
            projectId: project.id,
            itemId: updated.id,
            actorId,
            action: "ITEM_UNBLOCKED",
            meta: { title: updated.title },
          },
        });
      }

      const payload = await buildItemPayload(updated, position ?? null);
      io.to(`project:${project.id}`).emit("item:update", {
        item: payload,
        workspaceId: req.params.workspaceId,
        slug: req.params.slug,
      });

      if (existing.status !== "DONE" && updated.status === "DONE") {
        const dependents = await prisma.item.findMany({
          where: {
            projectId: project.id,
            relatedItemIds: { has: updated.id },
          },
        });
        for (const dependent of dependents) {
          if (dependent.status !== "ROADBLOCKED") continue;
          const deps = dependent.relatedItemIds.length
            ? await prisma.item.findMany({
                where: {
                  projectId: project.id,
                  id: { in: dependent.relatedItemIds },
                },
                select: { id: true, status: true },
              })
            : [];
          const depsDone =
            dependent.relatedItemIds.length > 0 &&
            deps.length === dependent.relatedItemIds.length &&
            deps.every((dep) => dep.status === "DONE");
          if (!depsDone) continue;
          const unblocked = await prisma.item.update({
            where: { id: dependent.id },
            data: { status: "TODO" },
          });
          const unblockedPayload = await buildItemPayload(unblocked, null);
          io.to(`project:${project.id}`).emit("item:update", {
            item: unblockedPayload,
            workspaceId: req.params.workspaceId,
            slug: req.params.slug,
          });
          await prisma.activityLog.create({
            data: {
              projectId: project.id,
              itemId: unblocked.id,
              actorId,
              action: "ITEM_UNBLOCKED",
              meta: { title: unblocked.title },
            },
          });
          if (unblocked.assigneeIds.length > 0) {
            for (const userId of unblocked.assigneeIds) {
              if (userId === actorId) continue;
              const notification = await prisma.notification.create({
                data: {
                  userId,
                  workspaceId: req.params.workspaceId,
                  itemId: unblocked.id,
                  type: "UNBLOCKED",
                  message: `"${unblocked.title}" is now unblocked.`,
                  meta: {
                    itemId: unblocked.id,
                    title: unblocked.title,
                    projectId: project.id,
                  },
                },
              });
              emitNotification(notification);
            }
          }
        }
      }

      res.json({ item: payload });
    } catch {
      res.status(500).json({ error: "Failed to update item." });
    }
  }
);

app.delete(
  "/api/workspaces/:workspaceId/projects/:slug/items/:itemId",
  requireAuth,
  requireWorkspaceAccess,
  async (req, res) => {
    try {
      const project = await ensureProject(req.params.workspaceId, req.params.slug);
      const existing = await prisma.item.findFirst({
        where: { id: req.params.itemId, projectId: project.id },
      });
      if (!existing) {
        res.status(404).json({ error: "Item not found." });
        return;
      }
      const actorId = (req.user as { id: string }).id;
      await prisma.activityLog.create({
        data: {
          projectId: project.id,
          itemId: existing.id,
          actorId,
          action: "ITEM_DELETED",
          meta: { title: existing.title },
        },
      });
      await prisma.item.delete({ where: { id: req.params.itemId } });
      io.to(`project:${project.id}`).emit("item:delete", {
        itemId: existing.id,
        workspaceId: req.params.workspaceId,
        slug: req.params.slug,
      });
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "Failed to delete item." });
    }
  }
);

app.get(
  "/api/workspaces/:workspaceId/projects/:slug/items/:itemId/comments",
  requireAuth,
  requireWorkspaceAccess,
  async (req, res) => {
    try {
      const project = await ensureProject(req.params.workspaceId, req.params.slug);
      const item = await prisma.item.findFirst({
        where: { id: req.params.itemId, projectId: project.id },
      });
      if (!item) {
        res.status(404).json({ error: "Item not found." });
        return;
      }
      const comments = await prisma.comment.findMany({
        where: { itemId: item.id },
        include: { user: true },
        orderBy: { createdAt: "asc" },
      });
      res.json({
        comments: comments.map((comment) => ({
          id: comment.id,
          body: comment.body,
          createdAt: comment.createdAt,
          user: {
            id: comment.user.id,
            name: comment.user.name,
            email: comment.user.email,
            avatarUrl: comment.user.avatarUrl,
          },
        })),
      });
    } catch {
      res.status(500).json({ error: "Failed to load comments." });
    }
  }
);

app.post(
  "/api/workspaces/:workspaceId/projects/:slug/items/:itemId/comments",
  requireAuth,
  requireWorkspaceAccess,
  async (req, res) => {
    const user = req.user as { id: string; email: string };
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!body) {
      res.status(400).json({ error: "Comment body is required." });
      return;
    }
    try {
      const project = await ensureProject(req.params.workspaceId, req.params.slug);
      const item = await prisma.item.findFirst({
        where: { id: req.params.itemId, projectId: project.id },
      });
      if (!item) {
        res.status(404).json({ error: "Item not found." });
        return;
      }
      const comment = await prisma.comment.create({
        data: {
          itemId: item.id,
          userId: user.id,
          body,
        },
        include: { user: true },
      });
      await prisma.activityLog.create({
        data: {
          projectId: project.id,
          itemId: item.id,
          actorId: user.id,
          action: "COMMENT_ADDED",
          meta: { body },
        },
      });
      res.json({
        comment: {
          id: comment.id,
          body: comment.body,
          createdAt: comment.createdAt,
          user: {
            id: comment.user.id,
            name: comment.user.name,
            email: comment.user.email,
            avatarUrl: comment.user.avatarUrl,
          },
        },
      });
    } catch {
      res.status(500).json({ error: "Failed to add comment." });
    }
  }
);

app.get(
  "/api/workspaces/:workspaceId/projects/:slug/items/:itemId/activity",
  requireAuth,
  requireWorkspaceAccess,
  async (req, res) => {
    try {
      const project = await ensureProject(req.params.workspaceId, req.params.slug);
      const item = await prisma.item.findFirst({
        where: { id: req.params.itemId, projectId: project.id },
      });
      if (!item) {
        res.status(404).json({ error: "Item not found." });
        return;
      }
      const activity = await prisma.activityLog.findMany({
        where: { itemId: item.id },
        include: { actor: true },
        orderBy: { createdAt: "desc" },
      });
      res.json({
        activity: activity.map((entry) => ({
          id: entry.id,
          action: entry.action,
          meta: entry.meta,
          createdAt: entry.createdAt,
          actor: {
            id: entry.actor.id,
            name: entry.actor.name,
            email: entry.actor.email,
            avatarUrl: entry.actor.avatarUrl,
          },
        })),
      });
    } catch {
      res.status(500).json({ error: "Failed to load activity." });
    }
  }
);

server.listen(PORT, () => {
  console.log(`Vennify API running on http://localhost:${PORT}`);
});
