UPDATE ${worldId:name}.${type:name}
SET best_${recordType:raw} = ${value},
    best_${recordType:raw}_date = TIMEZONE('UTC', NOW())
WHERE id = ${id}
