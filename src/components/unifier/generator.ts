import * as fs from "fs";
import * as combinatorics from "js-combinatorics";
import { inject, injectable, multiInject, optional } from "inversify";
import { Component } from "inversify-components";
import { CLIGeneratorExtension } from "../root/public-interfaces";
import { componentInterfaces, Configuration } from "./private-interfaces";
import { GenericIntent, intent, PlatformGenerator, CustomEntity } from "./public-interfaces";
import { EntityMapper } from "./entity-mapper";

@injectable()
export class Generator implements CLIGeneratorExtension {
  private platformGenerators: PlatformGenerator.Extension[] = [];
  private additionalUtteranceTemplatesServices: PlatformGenerator.UtteranceTemplateService[] = [];
  private intents: intent[] = [];
  private configuration: Configuration.Runtime;
  private entityMapper: EntityMapper;

  constructor(
    @inject("meta:component//core:unifier") componentMeta: Component<Configuration.Runtime>,
    @inject("core:state-machine:used-intents")
    @optional()
    intents: intent[],
    @multiInject(componentInterfaces.platformGenerator)
    @optional()
    generators: PlatformGenerator.Extension[],
    @multiInject(componentInterfaces.utteranceTemplateService)
    @optional()
    utteranceServices: PlatformGenerator.UtteranceTemplateService[],
    @inject("core:unifier:entity-mapper")
    @optional()
    entityMapper: EntityMapper
  ) {
    // Set default values. Setting them in the constructor leads to not calling the injections
    [intents, generators, utteranceServices, entityMapper].forEach(v => {
      // tslint:disable-next-line:no-parameter-reassignment
      if (typeof v === "undefined") v = [];
    });

    this.configuration = componentMeta.configuration;
    this.intents = intents;
    this.platformGenerators = generators;
    this.additionalUtteranceTemplatesServices = utteranceServices;
    this.entityMapper = entityMapper;
  }

  public async execute(buildDir: string): Promise<void> {
    // Get the main utterance templates for each defined language
    const utteranceTemplates = this.getUtteranceTemplates();

    // Iterate through each found language and build the utterance corresponding to the users entities
    const generatorPromises = Object.keys(utteranceTemplates)
      .map(language => {
        // Language specific build directory
        const localeBuildDirectory = buildDir + "/" + language;
        // Configuration for PlatformGenerator
        const buildIntentConfigs: PlatformGenerator.IntentConfiguration[] = [];
        // Contains the utterances generated from the utterance templates
        const utterances: { [intent: string]: string[] } = {};

        // Create build dir
        fs.mkdirSync(localeBuildDirectory);

        console.log("EntityMapper: ", JSON.stringify(this.entityMapper));

        // Add utterances from extensions to current template
        utteranceTemplates[language] = this.additionalUtteranceTemplatesServices.reduce((target, curr) => {
          const source = curr.getUtterancesFor(language);
          Object.keys(source).forEach(currIntent => {
            // Merge arrays of utterances or add intent to target
            target[currIntent] = target.hasOwnProperty(currIntent) ? target[currIntent].concat(source[currIntent]) : source[currIntent];
          });
          return target;
        }, utteranceTemplates[language]); // Initial value

        // Build utterances from templates
        Object.keys(utteranceTemplates[language]).forEach(currIntent => {
          utterances[currIntent] = this.generateUtterances(utteranceTemplates[language][currIntent], language);
        });

        // Build GenerateIntentConfiguration[] array based on these utterances and the found intents
        this.intents.forEach(currIntent => {
          let intentUtterances: string[] = [];

          // Associate utterances to intent
          if (typeof currIntent === "string") {
            intentUtterances = utterances[currIntent + "Intent"];
          } else {
            const baseName = GenericIntent[currIntent] + "GenericIntent";
            intentUtterances = utterances[baseName.charAt(0).toLowerCase() + baseName.slice(1)];
          }

          // If intentUtterances is "undefined", assign empty array
          if (typeof intentUtterances === "undefined") intentUtterances = [];

          // Extract entities from utterances
          const entities: string[] = [
            ...new Set(
              intentUtterances
                // Match all entities
                .map(utterance => utterance.match(/(?<=\{\{[A-Za-z0-9_äÄöÖüÜß,;'"\|-\s]*)(\w)+(?=\}\})/g))
                // Flatten array
                .reduce((prev, curr) => {
                  if (curr !== null) {
                    curr.forEach(parameter => (prev as string[]).push(parameter));
                  }
                  return prev;
                }, []) || []
            ),
          ];

          // Build intent specific entity mappings
          entities.map(name => {
            const entityMap = this.entityMapper.get(name);
            const entityMappings: PlatformGenerator.EntityMap[] = [];

            if (typeof entityMap !== "undefined") {
            }
          });
          // Check for unmapped entities
          const unmatchedEntity = entities.find(name => typeof this.entityMapper.get(name) === "undefined");
          if (typeof unmatchedEntity === "string") {
            throw Error(
              "Unknown entity '" +
                unmatchedEntity +
                "' found in utterances of intent '" +
                currIntent +
                "'. \n" +
                "Either you misspelled your entity in one of the intents utterances or you did not define a type mapping for it. " +
                "Your configured entity mappings are: " +
                JSON.stringify(this.entityMapper.getEntityNames())
            );
          }

          buildIntentConfigs.push({
            utterances: intentUtterances,
            entities,
            intent: currIntent,
          });
        });

        // Call all platform generators
        return this.platformGenerators.map(generator =>
          Promise.resolve(generator.execute(language, localeBuildDirectory, buildIntentConfigs.map(config => JSON.parse(JSON.stringify(config)))))
        );
      })
      .reduce((prev, curr) => prev.concat(curr));

    // Wait for all platform generators to finish
    await Promise.all(generatorPromises);
  }

  /**
   * Generate an array of utterances, based on the users utterance templates
   * @param templates
   */
  private generateUtterances(templates: string[], language: string): string[] {
    const utterances: string[] = [];

    // Extract all slot values and substitute them with a placeholder
    templates.map(template => {
      const slotValues: string[] = [];

      template = template.replace(/\{([A-Za-z0-9_äÄöÖüÜß,;'"\|\s]+)\}(?!\})/g, (match, param) => {
        slotValues.push(param.split("|"));
        return `{${slotValues.length - 1}}`;
      });

      // Generate all possible combinations with cartesian product
      if (slotValues.length > 0) {
        const combinations = combinatorics.cartesianProduct.apply(combinatorics, slotValues).toArray();
        // Substitute placeholders with combinations
        combinations.forEach(combi => {
          utterances.push(
            template.replace(/\{(\d+)\}/g, (match, param) => {
              return combi[param];
            })
          );
        });
      } else {
        utterances.push(template);
      }
    });

    // Extend utterances with entity synonyms and values
    return this.extendUtterances(utterances, language);
  }

  /**
   *
   * @param utterances
   */
  private extendUtterances(preUtterances: string[], language: string): string[] {
    const utterances: string[] = [];

    preUtterances.map(utterance => {
      const slotValues: any = [];
      // Replace all slots with a placeholder
      utterance = utterance.replace(/(?<=\{\{)([\-]{1})\|(\w+)*(?=\}\})/g, (match, value, name) => {
        const entityMap = this.entityMapper.get(name);
        if (typeof entityMap !== "undefined" && typeof entityMap.values !== "undefined") {
          const mergedValues: string[] = [];
          entityMap.values[language].forEach(param => {
            mergedValues.push(...param.synonyms, param.value);
          });
          slotValues.push(mergedValues);
          console.log("SlotValueS: ", slotValues);
          return `${slotValues.length - 1}|${name}`;
        }
        return name;
      });

      // Generate all possible entity combinations
      if (slotValues.length > 0) {
        const combinations = combinatorics.cartesianProduct.apply(combinatorics, slotValues).toArray();
        // Substitute placeholders with combinations
        combinations.forEach(combi => {
          utterances.push(
            utterance.replace(/(?<=[\{]+)(\d+)(?=\|)/g, (match, param) => {
              return combi[param];
            })
          );
        });
      } else {
        utterances.push(utterance);
      }
    });
    return utterances;
  }

  /**
   * Return the user defined utterance templates for each language found in locales folder
   */
  private getUtteranceTemplates(): { [language: string]: { [intent: string]: string[] } } {
    const utterances = {};
    const utterancesDir = this.configuration.utterancePath;
    const languages = fs.readdirSync(utterancesDir);
    languages.forEach(language => {
      const utterancePath = utterancesDir + "/" + language + "/utterances.json";
      if (fs.existsSync(utterancePath)) {
        const current = JSON.parse(fs.readFileSync(utterancePath).toString());
        utterances[language] = current;
      }
    });
    return utterances;
  }
}
