// Small tags on a site: its environment type, and the "new analog" / "false friend" badges.
import { ENVIRONMENT_LABELS, FACTOR_LABELS } from "../content/labels.js";
import { isNewAnalog, weakestFactor } from "../data/scoring.js";
import { formatKm } from "../data/format.js";

export function EnvironmentTag({ envType }) {
  if (!envType) return null;
  return <span className={`environment-tag environment-${envType}`}>{ENVIRONMENT_LABELS[envType] ?? envType}</span>;
}

/** Badges explain themselves in words, so nobody has to hover to learn what they mean. */
export function SiteBadges({ site }) {
  const showsNewAnalog = isNewAnalog(site);
  const showsFalseFriend = Boolean(site.false_friend);
  if (!showsNewAnalog && !showsFalseFriend) return null;

  return (
    <ul className="site-badges">
      {showsNewAnalog && (
        <li className="badge badge-new">
          <strong>New analog</strong>
          <span>{formatKm(site.km_to_nearest_known_analog)} from any known test site</span>
        </li>
      )}
      {showsFalseFriend && (
        <li className="badge badge-false-friend">
          <strong>False friend</strong>
          <span>
            {/* Plan v2.1 rule: terrain alike, but the factor the mission weights most is far off. */}
            Looks alike from above, but its {FACTOR_LABELS[site.false_friend_factor ?? weakestFactor(site.breakdown ?? {})].toLowerCase()}, which this mission counts most, is far off
          </span>
        </li>
      )}
    </ul>
  );
}
