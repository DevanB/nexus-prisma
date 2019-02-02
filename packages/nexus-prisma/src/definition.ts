import { core, objectType, arg } from 'nexus'
import { isPrismaSchemaBuilder } from './builder'
import {
  InputField,
  PickInputField,
  FilterInputField,
  AddFieldInput,
  PrismaOutputOpts,
  PrismaOutputOptsMap,
  PrismaSchemaConfig,
} from './types'
import { isObjectType, GraphQLSchema, GraphQLNamedType } from 'graphql'
import { getTypeName, isListOrRequired, findObjectTypeField } from './graphql'
import { generateDefaultResolver } from './resolver'
import { getFields, whitelistArgs, isConnectionTypeName } from './utils'

type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>

export interface PrismaObjectDefinitionBlock<TypeName extends string>
  extends core.ObjectDefinitionBlock<TypeName> {
  prismaType: PrismaOutputOptsMap
  prismaFields(inputFields?: InputField<TypeName>[]): void
  prismaFields(pickFields: PickInputField<TypeName>): void
  prismaFields(filterFields: FilterInputField<TypeName>): void
  prismaFields(inputFields?: AddFieldInput<TypeName>): void
}

export interface PrismaObjectTypeConfig<TypeName extends string>
  extends Omit<core.NexusObjectTypeConfig<TypeName>, 'definition'> {
  definition(t: PrismaObjectDefinitionBlock<TypeName>): void
}

export function prismaObjectType<TypeName extends string>(
  typeConfig: PrismaObjectTypeConfig<TypeName>,
) {
  return core.nexusWrappedFn(builder => {
    const { definition, ...rest } = typeConfig
    if (!isPrismaSchemaBuilder(builder)) {
      throw new Error('prismaObjectType can only be used by makePrismaSchema')
    }
    const prismaSchema = builder.getPrismaSchema()
    const prismaType = generatePrismaTypes(
      prismaSchema,
      typeConfig,
      builder.getConfig(),
    )
    return objectType({
      ...rest,
      definition(t) {
        const prismaBlock = t as PrismaObjectDefinitionBlock<TypeName>
        prismaBlock.prismaType = prismaType
        prismaBlock.prismaFields = (inputFields: any) => {
          const typeName = this.name
          const fields = getFields(inputFields, typeName, prismaSchema)
          fields.forEach(field => {
            const fieldName =
              field.alias === undefined ? field.name : field.alias
            const fieldType = findObjectTypeField(
              typeName,
              field.name,
              prismaSchema,
            )
            const { list, ...rest } = prismaType[fieldType.name]
            const args = whitelistArgs(rest.args, field.args)
            const fieldTypeName = getTypeName(fieldType.type)
            t.field(fieldName, {
              type: fieldTypeName,
              list: list ? true : undefined,
              args,
              ...rest,
            })

            if (isConnectionTypeName(fieldTypeName)) {
              const [normalTypeName] = fieldTypeName.split('Connection')
              const edgeTypeName = `${normalTypeName}Edge`

              builder.addType(prismaSchema.getType(
                fieldTypeName,
              ) as GraphQLNamedType)
              builder.addType(prismaSchema.getType(
                edgeTypeName,
              ) as GraphQLNamedType)
            }
          })
        }
        definition(prismaBlock)
      },
    })
  })
}

function generatePrismaTypes(
  prismaSchema: GraphQLSchema,
  objectConfig: PrismaObjectTypeConfig<any>,
  builderConfig: PrismaSchemaConfig,
): Record<string, PrismaOutputOpts> {
  const typeName = objectConfig.name
  const graphqlType = prismaSchema.getType(typeName)
  if (!isObjectType(graphqlType)) {
    throw new Error(
      `Must select a GraphQLObjectType, saw ${typeName} which is ${graphqlType}`,
    )
  }
  return Object.values(graphqlType.getFields()).reduce<PrismaOutputOptsMap>(
    (acc, field) => {
      acc[field.name] = {
        ...isListOrRequired(field.type),
        description: field.description,
        args: field.args.reduce<Record<string, any>>((acc, fieldArg) => {
          acc[fieldArg.name] = arg({
            type: getTypeName(fieldArg.type),
            ...isListOrRequired(fieldArg.type),
            description: fieldArg.description,
          })
          return acc
        }, {}),
        resolve: generateDefaultResolver(
          typeName,
          field,
          builderConfig.prisma.contextClientName,
        ),
      }
      return acc
    },
    {},
  )
}
