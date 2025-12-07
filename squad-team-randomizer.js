import BasePlugin from './base-plugin.js';

export default class SquadTeamRandomizer extends BasePlugin {
    static get description() {
        return (
            "The <code>SquadTeamRandomizer</code> randomizes teams while keeping squad members together. " +
            "It's great for maintaining squad cohesion while balancing teams. " +
            "It can be run by typing, by default, <code>!squadrandomize</code> into in-game admin chat"
        );
    }

    static get defaultEnabled() {
        return true;
    }

    static get optionsSpecification() {
        return {
            command: {
                required: false,
                description: 'The command used to randomize the teams while keeping squads together.',
                default: 'squadrandomize'
            }
        };
    }

    constructor(server, options, connectors) {
        super(server, options, connectors);

        this.onChatCommand = this.onChatCommand.bind(this);
        this.randomizeTeams = this.randomizeTeams.bind(this);
        this.buildGroupsFromPlayers = this.buildGroupsFromPlayers.bind(this);
        this.assignGroupsToTeams = this.assignGroupsToTeams.bind(this);
        this.applyAssignments = this.applyAssignments.bind(this);
        this.switchGroupToTeam = this.switchGroupToTeam.bind(this);
    }

    async mount() {
        this.server.on(`CHAT_COMMAND:${this.options.command}`, this.onChatCommand);
    }

    async unmount() {
        this.server.removeEventListener(`CHAT_COMMAND:${this.options.command}`, this.onChatCommand);
    }

    async onChatCommand(info) {
        if (info.chat !== 'ChatAdmin') return;

        try {
            await this.server.updatePlayerList();
            await this.server.updateSquadList();

            const players = (this.server.players || []).filter((p) => p?.steamID);
            if (players.length === 0) {
                this.server.rcon.warn(info.steamID, 'Keine Spieler zum Randomisieren gefunden.');
                return;
            }

            this.server.rcon.broadcast('Teams werden zufällig neu zusammengestellt, bitte einen Moment warten …');
            const summary = await this.randomizeTeams(players);
            this.server.rcon.broadcast('Teams wurden neu gemischt. Viel Erfolg!');
            this.server.rcon.warn(info.steamID, summary);
        } catch (error) {
            console.error('[SquadTeamRandomizer]', error);
            this.server.rcon.warn(info.steamID, 'Randomizer fehlgeschlagen – siehe Server-Konsole für Details.');
        }
    }

    async randomizeTeams(players) {
        const groups = this.buildGroupsFromPlayers(players);
        if (groups.length === 0) {
            return 'Keine gültigen Gruppen gefunden.';
        }

        const { assignments, teamSizes } = this.assignGroupsToTeams(groups);
        await this.applyAssignments(assignments);

        return `Randomizer fertig: Team 1 = ${teamSizes[1]} Spieler, Team 2 = ${teamSizes[2]} Spieler.`;
    }

    buildGroupsFromPlayers(players) {
        const squads = new Map();
        const soloGroups = [];

        for (const player of players) {
            if (!player.teamID) continue;

            if (player.squadID) {
                const key = `${player.teamID}:${player.squadID}`;
                if (!squads.has(key)) {
                    squads.set(key, {
                        size: 0,
                        players: [],
                        label: `Squad ${player.squadID}`,
                        roll: Math.random()
                    });
                }
                const group = squads.get(key);
                group.players.push(player);
                group.size = group.players.length;
            } else {
                soloGroups.push({
                    size: 1,
                    players: [player],
                    label: `Solo ${player.name ?? player.steamID}`,
                    roll: Math.random()
                });
            }
        }

        return [...squads.values(), ...soloGroups];
    }

    assignGroupsToTeams(groups) {
        const ordered = groups
            .slice()
            .sort((a, b) => b.size - a.size || a.roll - b.roll);

        const assignments = { 1: [], 2: [] };
        const teamSizes = { 1: 0, 2: 0 };
        const totalPlayers = ordered.reduce((sum, group) => sum + group.size, 0);
        const targetTeamSize = Math.ceil(totalPlayers / 2);

        for (const group of ordered) {
            const canTeam1 = teamSizes[1] + group.size <= targetTeamSize || teamSizes[2] >= targetTeamSize;
            const canTeam2 = teamSizes[2] + group.size <= targetTeamSize || teamSizes[1] >= targetTeamSize;

            let targetTeam;
            if (!canTeam1 && canTeam2) targetTeam = 2;
            else if (!canTeam2 && canTeam1) targetTeam = 1;
            else if (teamSizes[1] === teamSizes[2]) targetTeam = Math.random() < 0.5 ? 1 : 2;
            else targetTeam = teamSizes[1] < teamSizes[2] ? 1 : 2;

            assignments[targetTeam].push(group);
            teamSizes[targetTeam] += group.size;
        }

        return { assignments, teamSizes };
    }

    async applyAssignments(assignments) {
        for (const [teamIdString, groups] of Object.entries(assignments)) {
            const teamID = Number(teamIdString);
            for (const group of groups) {
                await this.switchGroupToTeam(group.players, teamID);
            }
        }
    }

    async switchGroupToTeam(players, targetTeam) {
        for (const player of players) {
            if (player.teamID === targetTeam) continue;

            const identifier = player.eosID ?? player.steamID;
            if (!identifier) continue;

            await this.server.rcon.switchTeam(identifier);
            player.teamID = targetTeam;
        }
    }
}
