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
  }

  async mount() {
    this.server.on(`CHAT_COMMAND:${this.options.command}`, this.onChatCommand);
  }

  async unmount() {
    this.server.removeEventListener(`CHAT_COMMAND:${this.options.command}`, this.onChatCommand);
  }

  async onChatCommand(info) {
    if (info.chat !== 'ChatAdmin') return;

    // Get all players and group them by squad
    const players = this.server.players.slice(0);
    const squads = new Map();
    const noSquadPlayers = [];

    // Group players by their squad
    for (const player of players) {
      if (!player.squadID) {
        noSquadPlayers.push(player);
        continue;
      }
      
      if (!squads.has(player.squadID)) {
        squads.set(player.squadID, []);
      }
      squads.get(player.squadID).push(player);
    }

    // Convert squads map to array and shuffle it
    const squadArray = Array.from(squads.values());
    let currentIndex = squadArray.length;
    let temporaryValue;
    let randomIndex;

    // Shuffle the squads
    while (currentIndex !== 0) {
      randomIndex = Math.floor(Math.random() * currentIndex);
      currentIndex -= 1;

      temporaryValue = squadArray[currentIndex];
      squadArray[currentIndex] = squadArray[randomIndex];
      squadArray[randomIndex] = temporaryValue;
    }

    // Calculate total players and target team size
    const totalPlayers = players.length;
    const targetTeamSize = Math.floor(totalPlayers / 2);

    // Assign teams to squads and track team sizes
    let team1Size = 0;
    let team2Size = 0;
    let team = '1';

    // First, assign squads to teams
    for (const squad of squadArray) {
      const squadSize = squad.length;
      
      // Check if adding this squad would make the team too large
      if (team === '1' && team1Size + squadSize > targetTeamSize + 1) {
        team = '2';
      } else if (team === '2' && team2Size + squadSize > targetTeamSize + 1) {
        team = '1';
      }

      // Move all players in the squad to the same team
      for (const player of squad) {
        if (player.teamID !== team) {
          await this.server.rcon.switchTeam(player.eosID);
        }
      }

      // Update team sizes
      if (team === '1') {
        team1Size += squadSize;
      } else {
        team2Size += squadSize;
      }

      // Switch team for next squad
      team = team === '1' ? '2' : '1';
    }

    // Calculate how many noSquadPlayers need to go to each team
    const team1Needed = targetTeamSize - team1Size;
    const team2Needed = targetTeamSize - team2Size;

    // Assign noSquadPlayers to balance teams
    for (let i = 0; i < noSquadPlayers.length; i++) {
      const player = noSquadPlayers[i];
      let targetTeam;

      if (i < team1Needed) {
        targetTeam = '1';
      } else if (i < team1Needed + team2Needed) {
        targetTeam = '2';
      } else {
        // If we have more noSquadPlayers than needed, assign to the smaller team
        targetTeam = team1Size <= team2Size ? '1' : '2';
      }

      if (player.teamID !== targetTeam) {
        await this.server.rcon.switchTeam(player.eosID);
      }
    }
  }
} 
