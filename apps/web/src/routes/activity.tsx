import { createFileRoute } from "@tanstack/react-router";
import { ActivityList } from "@/components/activity-list";
import { WithSnapshot } from "@/components/chain-state";

export const Route = createFileRoute("/activity")({ component: ActivityPage });

function ActivityPage() {
  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-4xl sm:text-5xl">Activity</h1>
      <p className="mt-2 text-muted-foreground">
        Everything your agents did with their cards, including the attempts the cards refused.
      </p>
      <div className="mt-8">
        <WithSnapshot>
          {({ activity, cards }) =>
            activity.length === 0 ? (
              <p className="text-muted-foreground">No activity yet. Issue a card and give its agent a task.</p>
            ) : (
              <ActivityList activity={activity} cards={cards} groupByDay />
            )
          }
        </WithSnapshot>
      </div>
    </div>
  );
}
