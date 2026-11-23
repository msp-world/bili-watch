/**
 * B 站视频信息/字幕/评论读取 MSP World（移植自 cortico-world-bili-watch）：
 * - 工具：video_probe, video_comments
 * - 信号：bili_watch.video_probed
 */
import type { MSPNode } from "../shared/msp.ts";

export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

function extractBvid(input: string): string | null {
  const m = /(BV[0-9A-Za-z]{10})/.exec(input);
  return m ? m[1] : null;
}

export class BiliWatchWorld {
  private readonly fetchImpl: FetchImpl;
  private node: MSPNode | null = null;

  constructor(fetchImpl?: FetchImpl) {
    this.fetchImpl = fetchImpl ?? ((u, i) => fetch(u, i));
  }

  attach(node: MSPNode): void {
    this.node = node;
    node.declareSignal("bili_watch.video_probed", "已读取 B 站视频元数据");

    node.tool(
      "video_probe",
      "读取 B 站视频元信息（标题、UP主、时长、分P、简介与统计）",
      async (args) => {
        const bvid = extractBvid(String(args.video ?? ""));
        if (!bvid) throw new Error("请提供有效的 B 站 BV 号或视频链接");
        const res = await this.fetchImpl(
          `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
          { signal: AbortSignal.timeout(8000) },
        );
        if (!res.ok) throw new Error(`Bili API HTTP ${res.status}`);
        const json = (await res.json()) as { code: number; message?: string; data?: any };
        if (json.code !== 0 || !json.data) throw new Error(json.message || "未找到视频");
        const d = json.data;
        const out = {
          bvid: d.bvid,
          aid: d.aid,
          title: d.title,
          owner: d.owner?.name ?? "",
          durationSec: d.duration,
          desc: d.desc,
          pages: Array.isArray(d.pages) ? d.pages.map((p: any) => ({ page: p.page, part: p.part, duration: p.duration })) : [],
          stat: d.stat ?? {},
        };
        this.node?.publish("bili_watch.video_probed", { bvid: out.bvid, title: out.title });
        return out;
      },
      { type: "object", required: ["video"], properties: { video: { type: "string" } } },
    );

    node.tool(
      "video_comments",
      "读取 B 站视频热门评论区前若干条",
      async (args) => {
        const oid = Number(args.aid);
        if (!Number.isInteger(oid) || oid <= 0) throw new Error("请提供有效的数字 aid");
        const limit = typeof args.limit === "number" ? Math.min(Math.max(1, args.limit), 20) : 10;
        const res = await this.fetchImpl(
          `https://api.bilibili.com/x/v2/reply?type=1&oid=${oid}&sort=2&ps=${limit}&pn=1`,
          { signal: AbortSignal.timeout(8000) },
        );
        if (!res.ok) throw new Error(`Bili Reply API HTTP ${res.status}`);
        const json = (await res.json()) as { data?: { replies?: any[] } };
        const replies = (json?.data?.replies ?? []).map((r) => ({
          user: r.member?.uname ?? "",
          like: r.like ?? 0,
          message: r.content?.message ?? "",
        }));
        return { aid: oid, count: replies.length, replies };
      },
      { type: "object", required: ["aid"], properties: { aid: { type: "integer" }, limit: { type: "integer", default: 10 } } },
    );

    node.skill({
      name: "inspect_video",
      summary: "先用 BV 号或链接探测视频元信息拿到 aid，再按 aid 拉取热门评论",
      whenToUse: "需要了解 B 站视频内容与观众评论反馈时使用",
      toolsUsed: ["video_probe", "video_comments"],
    });
  }
}
