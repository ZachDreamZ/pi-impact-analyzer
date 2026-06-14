import { greet, farewell } from "./greeter";

export function run(name: string): string {
	const greeting = greet(name);
	const goodbye = farewell(name);
	return `${greeting} ${goodbye}`;
}

function internalHelper(): number {
	return 42;
}

export class Runner {
	start(name: string): string {
		return run(name);
	}

	getAnswer(): number {
		return internalHelper();
	}
}
